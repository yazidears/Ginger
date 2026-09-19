import SwiftUI

@MainActor @Observable final class AshStore {
    static let shared = AshStore()
    var tab = 1
    var sector = Sector.all[0]
    var demo = true
    var useGPS = false
    var server = UserDefaults.standard.string(forKey: "gingerServer") ?? "http://localhost:3003"
    var reply: AshReply? = .exercise(question: "briefing")
    var turns: [ConversationTurn] = []
    var loading = false
    var error: String?
    var question = ""
    let voice = VoiceController()
    let location = FieldLocation()
    private var requestTask: Task<Void, Never>?
    private var generation = UUID()
    init() {
        #if DEBUG
        // Device setup through devicectl; the provider key never enters the app.
        let environment = ProcessInfo.processInfo.environment
        if let address = environment["ASH_SETUP_SERVER"], let token = environment["ASH_SETUP_TOKEN"], token.count >= 32 {
            do {
                _ = try GingerClient.endpoint(address)
                try AshCredentials.save(token, for: address)
                server = address
                UserDefaults.standard.set(address, forKey: "gingerServer")
                demo = false
                reply = nil
            } catch { self.error = "Could not save the development connection: " + error.localizedDescription }
        }
        #endif
    }
    var token: String { AshCredentials.token(for: server) }
    var contextSector: Sector {
        if !demo, useGPS, let fix = location.fix { return Sector(id: "gps", name: fix.isFresh ? "Your GPS position" : "Last GPS fix", lat: fix.lat, lon: fix.lon) }
        return sector
    }
    func resetContext() {
        generation = UUID(); requestTask?.cancel(); loading = false
        voice.stopAll(); error = nil; turns = []; question = ""
        reply = demo ? .exercise(question: "briefing") : nil
        if useGPS && !demo { location.start() } else { location.stop() }
    }
    func startSession() async {
        voice.onQuestion = { [weak self] text in
            guard let self else { throw CancellationError() }
            return try await self.answer(text).answer
        }
        if useGPS && !demo { location.start() }
        await voice.start(address: server, token: token)
    }
    func endSession() { voice.stopAll(); location.stop() }
    private func answer(_ text: String) async throws -> AshReply {
        guard text.count <= 500 else { throw GingerClient.ClientError.message("Please ask a shorter question.") }
        let id = generation
        let fix: PositionFix?
        if useGPS && !demo {
            guard let value = location.fix, value.isFresh else { throw GingerClient.ClientError.message("A fresh GPS fix is required. No other location was substituted.") }
            fix = value
        } else { fix = nil }
        loading = true
        defer { if generation == id { loading = false } }
        let result: AshReply
        if demo { result = .exercise(question: text) }
        else { result = try await GingerClient.ask(text, sector: contextSector, address: server, fix: fix, token: token) }
        try Task.checkCancellation(); guard generation == id else { throw CancellationError() }
        reply = result; turns.append(ConversationTurn(question: text, reply: result)); turns = Array(turns.suffix(30)); question = ""; error = nil
        return result
    }
    func ask(_ text: String, spoken: Bool = false) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 500, !loading, !voice.active else { return }
        error = nil
        requestTask = Task {
            do { let result = try await answer(text); if spoken { voice.speak(result.answer, address: server, token: token) } }
            catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
}
@main struct AshApp: App {
    @State private var store = AshStore.shared
    var body: some Scene { WindowGroup { AshRootView().environment(store).preferredColorScheme(.dark) } }
}
