import AVFoundation
import Observation

@MainActor @Observable final class VoiceController: NSObject, AVAudioPlayerDelegate {
    var active = false
    var listening = false
    var preparing = false
    var preparationMessage = "Connecting to Ginger…"
    var speaking = false
    var processing = false
    var transcript = ""
    var error: String?
    var route = "No active audio route"
    var onQuestion: ((String) async throws -> String)?
    private let engine = AVAudioEngine()
    private let segmenter = AudioSegmenter()
    private var player: AVAudioPlayer?
    private var playback: CheckedContinuation<Void, Error>?
    private var task: Task<Void, Never>?
    private var connectionTask: Task<Void, Error>?
    private var tapInstalled = false
    private var generation = UUID()
    private var server = ""
    private var accessToken = ""
    private var failures = 0
    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(engineChanged), name: .AVAudioEngineConfigurationChange, object: engine)
        NotificationCenter.default.addObserver(self, selector: #selector(mediaReset), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
    }
    @objc private func interrupted(_ notification: Notification) {
        guard active || speaking || preparing else { return }
        stopAll(); error = "Audio interrupted. Resume the voice session when ready."
    }
    @objc private func engineChanged(_ notification: Notification) { if active && !engine.isRunning { stopAll(); error = "Audio configuration changed. Resume the voice session." } }
    @objc private func mediaReset(_ notification: Notification) { stopAll(); error = "Audio services restarted. Start a new session." }
    @objc private func routeChanged(_ notification: Notification) {
        updateRoute()
        guard active else { return }
        if let value = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
           value == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue || value == AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue {
            stopAll(); error = "Audio device changed. Check your AirPod, then resume the session."
        }
    }
    private func updateRoute() {
        let audio = AVAudioSession.sharedInstance()
        route = "Mic: " + audio.currentRoute.inputs.map(\.portName).joined(separator: ", ") + " · Out: " + audio.currentRoute.outputs.map(\.portName).joined(separator: ", ")
    }
    func start(address: String, token: String) async {
        guard !active, !preparing else { return }
        stopAll(); error = nil; preparing = true; transcript = ""
        let id = UUID(); generation = id; server = address; accessToken = token
        do {
            preparationMessage = "Connecting to Ginger…"
            let connection = Task { try await GingerClient.checkVoice(address: address, token: token) }
            connectionTask = connection
            try await connection.value
            connectionTask = nil
            guard generation == id, !Task.isCancelled else { return }
            preparationMessage = "Waiting for microphone permission…"
            let allowed = await AVAudioApplication.requestRecordPermission()
            guard generation == id else { return }
            guard allowed else { throw GingerClient.ClientError.message("Microphone access is required. Enable it for Ash in Settings.") }
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
            try audio.setActive(true)
            if let headset = audio.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) { try audio.setPreferredInput(headset) }
            try engine.inputNode.setVoiceProcessingEnabled(true)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw GingerClient.ClientError.message("No microphone input available.") }
            let segmenter = self.segmenter
            segmenter.setEnabled(true)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                guard let channel = buffer.floatChannelData?[0] else { return }
                let floats = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
                if let wav = segmenter.consume(floats, sampleRate: Int(buffer.format.sampleRate)) {
                    Task { @MainActor in guard let self, self.generation == id, self.active else { return }; self.handle(wav, id: id) }
                }
            }
            tapInstalled = true; engine.prepare(); try engine.start()
            preparing = false; active = true; listening = true; failures = 0; updateRoute()
        } catch { guard generation == id else { return }; stopAll(); self.error = error.localizedDescription }
    }
    private func handle(_ audio: Data, id: UUID) {
        processing = true; listening = false
        task = Task {
            do {
                let text = try await GingerClient.transcribe(audio, address: server, token: accessToken)
                try Task.checkCancellation(); guard generation == id else { return }
                transcript = text
                // Always listening during a started session, but only addressed questions trigger answers.
                guard let question = Self.addressedQuestion(text) else { resumeCapture(id: id); return }
                if ["stop", "stop listening", "end session"].contains(question.lowercased()) { stopAll(); return }
                guard let onQuestion else { throw GingerClient.ClientError.message("Ginger answer service is unavailable.") }
                let answer = try await onQuestion(question)
                try Task.checkCancellation(); guard generation == id else { return }
                let wav = try await GingerClient.speech(answer, address: server, token: accessToken)
                try Task.checkCancellation(); guard generation == id else { return }
                processing = false
                try await play(wav)
                failures = 0; resumeCapture(id: id)
            } catch {
                guard generation == id, !Task.isCancelled else { return }
                self.error = error.localizedDescription; failures += 1
                if failures >= 3 { let message = self.error; stopAll(); self.error = message }
                else { resumeCapture(id: id) }
            }
        }
    }
    static func addressedQuestion(_ transcript: String) -> String? {
        let pattern = #"(?i)^\s*(?:hey\s+)?ash[\s,:.!-]+(.+)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern), let match = regex.firstMatch(in: transcript, range: NSRange(transcript.startIndex..., in: transcript)), let range = Range(match.range(at: 1), in: transcript) else { return nil }
        let result = transcript[range].trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        return result.isEmpty ? nil : result
    }
    private func resumeCapture(id: UUID) { guard generation == id, active else { return }; processing = false; speaking = false; listening = true; segmenter.setEnabled(true) }
    private func play(_ audio: Data) async throws {
        let value = try AVAudioPlayer(data: audio); player = value; value.delegate = self; speaking = true
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            playback = continuation
            if !value.play() { playback = nil; speaking = false; continuation.resume(throwing: GingerClient.ClientError.message("Unable to play SLNG audio.")) }
        }
    }
    func speak(_ text: String, address: String, token: String) {
        stopAll(); error = nil; let id = UUID(); generation = id
        task = Task {
            do {
                preparing = true
                let audio = try await GingerClient.speech(text, address: address, token: token)
                try Task.checkCancellation(); guard generation == id else { return }
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                preparing = false; try await play(audio)
                if generation == id { stopAll() }
            } catch { if generation == id, !Task.isCancelled { stopAll(); self.error = error.localizedDescription } }
        }
    }
    func stopAll() {
        generation = UUID(); task?.cancel(); task = nil
        connectionTask?.cancel(); connectionTask = nil
        segmenter.setEnabled(false); engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        player?.stop(); player = nil
        let pending = playback; playback = nil; pending?.resume(throwing: CancellationError())
        active = false; listening = false; preparing = false; speaking = false; processing = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in guard self.player === player else { return }; self.speaking = false; let pending = self.playback; self.playback = nil; if flag { pending?.resume() } else { pending?.resume(throwing: GingerClient.ClientError.message("Audio playback failed.")) } }
    }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in guard self.player === player else { return }; let pending = self.playback; self.playback = nil; self.speaking = false; pending?.resume(throwing: GingerClient.ClientError.message("SLNG audio could not be decoded.")) }
    }
}
