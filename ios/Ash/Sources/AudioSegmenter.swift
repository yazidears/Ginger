import Foundation

/// Bounded mono PCM utterance buffer. All mutable state is lock-protected across the audio and main queues.
final class AudioSegmenter: @unchecked Sendable {
    private let lock = NSLock()
    private var enabled = true
    private var samples: [Int16] = []
    private var preRoll: [Int16] = []
    private var silentFrames = 0
    private var voicedFrames = 0
    private var currentRate = 0
    func setEnabled(_ value: Bool) { lock.lock(); defer { lock.unlock() }; enabled = value; clear() }
    private func clear() { samples.removeAll(keepingCapacity: true); preRoll.removeAll(keepingCapacity: true); silentFrames = 0; voicedFrames = 0 }
    func consume(_ floats: [Float], sampleRate: Int) -> Data? {
        lock.lock(); defer { lock.unlock() }
        guard enabled, sampleRate > 0, !floats.isEmpty else { return nil }
        if currentRate != sampleRate { clear(); currentRate = sampleRate }
        let clean = floats.map { $0.isFinite ? $0 : 0 }
        let rms = sqrt(clean.reduce(Float(0)) { $0 + $1 * $1 } / Float(clean.count))
        let voiced = rms > 0.008 // Approximately -42 dBFS; field-noise tuning requires hardware acceptance.
        let pcm = clean.map { Int16(max(-32767, min(32767, $0 * 32767))) }
        if samples.isEmpty && !voiced {
            preRoll.append(contentsOf: pcm)
            if preRoll.count > sampleRate / 4 { preRoll.removeFirst(preRoll.count - sampleRate / 4) }
            return nil
        }
        if samples.isEmpty { samples = preRoll; preRoll.removeAll(keepingCapacity: true) }
        samples.append(contentsOf: pcm)
        if voiced { voicedFrames += pcm.count; silentFrames = 0 } else { silentFrames += pcm.count }
        guard silentFrames >= sampleRate || samples.count >= sampleRate * 15 else { return nil }
        guard voicedFrames >= sampleRate / 3 else { clear(); return nil }
        let result = Self.wav(samples, rate: sampleRate)
        clear(); enabled = false // Backpressure: one request/reply at a time; never queue stale radio traffic.
        return result
    }
    static func wav(_ samples: [Int16], rate: Int) -> Data {
        var data = Data()
        func text(_ value: String) { data.append(contentsOf: value.utf8) }
        func u32(_ value: Int) { var n = UInt32(value).littleEndian; withUnsafeBytes(of: &n) { data.append(contentsOf: $0) } }
        func u16(_ value: Int) { var n = UInt16(value).littleEndian; withUnsafeBytes(of: &n) { data.append(contentsOf: $0) } }
        text("RIFF"); u32(36 + samples.count * 2); text("WAVEfmt "); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16); text("data"); u32(samples.count * 2)
        for sample in samples { var n = sample.littleEndian; withUnsafeBytes(of: &n) { data.append(contentsOf: $0) } }
        return data
    }
}
