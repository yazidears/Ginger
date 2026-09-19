import SwiftUI
import MultipeerConnectivity
import AVFoundation

struct CrewMessage: Identifiable {
    let id: UUID
    let sender: String
    let audio: Data
    let date: Date
    var receipt: String
}
private struct RadioPacket: Codable { let id: UUID; let kind: String; let audio: Data? }

@MainActor @Observable final class CrewRadio: NSObject {
    var enabled = false
    var recording = false
    var preparing = false
    var peers: [String] = []
    var messages: [CrewMessage] = []
    var error: String?
    var invitation: String?
    private var invitationHandler: ((Bool, MCSession?) -> Void)?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var timeout: Task<Void, Never>?
    private var generation = UUID()
    let peerID = MCPeerID(displayName: "Ash-" + String(UUID().uuidString.prefix(4)))
    @ObservationIgnored lazy var session: MCSession = {
        let value = MCSession(peer: peerID, securityIdentity: nil, encryptionPreference: .required)
        value.delegate = self
        return value
    }()
    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
    }
    @objc private func interrupted(_ notification: Notification) { cancelRecording(); player?.stop(); error = "Audio interrupted. Recording was discarded." }
    @objc private func routeChanged(_ notification: Notification) {
        if let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { interrupted(notification) }
    }
    func enable() {
        guard !enabled else { return }
        error = nil; enabled = true
        advertiser = MCNearbyServiceAdvertiser(peer: peerID, discoveryInfo: nil, serviceType: "ash-field")
        advertiser?.delegate = self; advertiser?.startAdvertisingPeer()
    }
    func disable() {
        cancelRecording(); player?.stop(); respond(false)
        advertiser?.stopAdvertisingPeer(); advertiser = nil; session.disconnect(); enabled = false; peers = []
    }
    func respond(_ accept: Bool) { invitationHandler?(accept, accept ? session : nil); invitationHandler = nil; invitation = nil }
    func beginRecording() async {
        guard enabled, !session.connectedPeers.isEmpty, !preparing, !recording else { return }
        preparing = true; error = nil; player?.stop()
        let token = UUID(); generation = token
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard token == generation else { return }
        preparing = false
        guard allowed else { error = "Microphone permission is required to record a crew message."; return }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
            try audio.setActive(true)
            let url = FileManager.default.temporaryDirectory.appending(path: "ash-\(UUID().uuidString).m4a")
            let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 24000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32000])
            self.recorder = recorder
            guard recorder.record() else { throw GingerClient.ClientError.message("Could not start recording.") }
            recording = true
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                if !Task.isCancelled { self?.cancelRecording(); self?.error = "30-second limit reached. Recording discarded; record a shorter message." }
            }
        } catch { cancelRecording(); self.error = error.localizedDescription }
    }
    func cancelRecording() {
        let ownedAudio = recorder != nil
        generation = UUID(); preparing = false; timeout?.cancel(); timeout = nil
        recorder?.stop()
        if let url = recorder?.url { try? FileManager.default.removeItem(at: url) }
        recorder = nil; recording = false
        if ownedAudio { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
    func sendRecording() {
        guard recording, let recorder else { return }
        recorder.stop(); timeout?.cancel(); recording = false
        defer { cancelRecording() }
        do {
            guard !session.connectedPeers.isEmpty else { throw GingerClient.ClientError.message("No crew connected. Message was not sent.") }
            let audio = try Data(contentsOf: recorder.url)
            guard audio.count <= 1_000_000 else { throw GingerClient.ClientError.message("Message is too large.") }
            let id = UUID()
            try session.send(JSONEncoder().encode(RadioPacket(id: id, kind: "audio", audio: audio)), toPeers: session.connectedPeers, with: .reliable)
            messages.insert(CrewMessage(id: id, sender: "You", audio: audio, date: Date(), receipt: "Sent · awaiting receipt"), at: 0)
            messages = Array(messages.prefix(30))
        } catch { self.error = error.localizedDescription }
    }
    func play(_ message: CrewMessage) {
        guard !recording, !preparing else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            player = try AVAudioPlayer(data: message.audio); player?.play()
        } catch { self.error = "This voice message could not be played." }
    }
    func stopAudio() { cancelRecording(); player?.stop() }
}
extension CrewRadio: MCNearbyServiceAdvertiserDelegate {
    nonisolated func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        Task { @MainActor in
            guard self.enabled, self.invitationHandler == nil else { invitationHandler(false, nil); return }
            self.invitation = peerID.displayName; self.invitationHandler = invitationHandler
        }
    }
    nonisolated func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) { Task { @MainActor in self.error = error.localizedDescription; self.enabled = false } }
}
extension CrewRadio: MCSessionDelegate {
    nonisolated func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        let names = session.connectedPeers.map(\.displayName)
        Task { @MainActor in self.peers = names }
    }
    nonisolated func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard data.count <= 1_400_000, let packet = try? JSONDecoder().decode(RadioPacket.self, from: data) else { return }
        Task { @MainActor in
            if packet.kind == "receipt" {
                if let index = self.messages.firstIndex(where: { $0.id == packet.id }) { self.messages[index].receipt = "Received by \(peerID.displayName)" }
            } else if packet.kind == "audio", let audio = packet.audio, audio.count <= 1_000_000 {
                guard !self.messages.contains(where: { $0.id == packet.id }), (try? AVAudioPlayer(data: audio)) != nil else { return }
                self.messages.insert(CrewMessage(id: packet.id, sender: peerID.displayName, audio: audio, date: Date(), receipt: "Received · tap to listen"), at: 0)
                self.messages = Array(self.messages.prefix(30))
                if let ack = try? JSONEncoder().encode(RadioPacket(id: packet.id, kind: "receipt", audio: nil)) { try? session.send(ack, toPeers: [peerID], with: .reliable) }
            }
        }
    }
    nonisolated func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    nonisolated func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    nonisolated func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
struct CrewBrowser: UIViewControllerRepresentable {
    let radio: CrewRadio
    @Environment(\.dismiss) private var dismiss
    func makeCoordinator() -> Coordinator { Coordinator { dismiss() } }
    func makeUIViewController(context: Context) -> MCBrowserViewController {
        let browser = MCBrowserViewController(serviceType: "ash-field", session: radio.session)
        browser.delegate = context.coordinator
        return browser
    }
    func updateUIViewController(_ uiViewController: MCBrowserViewController, context: Context) {}
    final class Coordinator: NSObject, MCBrowserViewControllerDelegate {
        let dismiss: () -> Void
        init(dismiss: @escaping () -> Void) { self.dismiss = dismiss }
        func browserViewControllerDidFinish(_ browserViewController: MCBrowserViewController) { dismiss() }
        func browserViewControllerWasCancelled(_ browserViewController: MCBrowserViewController) { dismiss() }
    }
}
