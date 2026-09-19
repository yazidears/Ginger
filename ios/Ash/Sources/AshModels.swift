import Foundation

struct Sector: Identifiable, Hashable {
    let id: String
    let name: String
    let lat: Double
    let lon: Double
    static let all = [Sector(id: "garraf", name: "Garraf", lat: 41.3, lon: 1.86), Sector(id: "penedes", name: "Alt Penedès", lat: 41.35, lon: 1.69), Sector(id: "bages", name: "Bages", lat: 41.73, lon: 1.83), Sector(id: "montseny", name: "Montseny", lat: 41.76, lon: 2.4), Sector(id: "ebre", name: "Terres de l’Ebre", lat: 40.82, lon: 0.52), Sector(id: "emporda", name: "Alt Empordà", lat: 42.27, lon: 2.96)]
}
struct AshReply: Codable {
    struct Weather: Codable { let time: String; let temperatureC: Double; let humidityPct: Double; let windKmh: Double; let windFromDegrees: Double }
    struct Source: Codable, Identifiable { var id: String { source }; let source: String; let status: String; let retrievedAt: String; let detail: String }
    struct Situation: Codable {
        struct DGPS: Codable { let available: Bool; let reason: String }
        struct Observation: Codable, Identifiable { let id: String; let text: String; let distanceM: Int; let createdAt: String; let verification: String }
        struct FieldTask: Codable, Identifiable { let id: String; let title: String; let distanceM: Int; let status: String }
        let dgps: DGPS
        let operationsAvailable: Bool
        let observations: [Observation]
        let tasks: [FieldTask]
        let scope: String
    }
    var position: PositionFix? = nil
    var situation: Situation? = nil
    let mode: String
    let topic: String
    let answer: String
    let generatedAt: String
    let weather: Weather?
    let hotspots: Int?
    let sources: [Source]
    let missing: [String]
    var date: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: generatedAt) ?? ISO8601DateFormatter().date(from: generatedAt)
    }
    var isStale: Bool { mode != "demo" && (date.map { Date().timeIntervalSince($0) > 600 } ?? true) }
    static func exercise(question: String) -> AshReply {
        let weather = Weather(time: "Exercise snapshot", temperatureC: 28, humidityPct: 32, windKmh: 18, windFromDegrees: 225)
        let text: String
        if question.lowercased().contains("wind") || question.lowercased().contains("weather") { text = "Exercise only. Modelled wind is 18 kilometres per hour from the southwest. Temperature 28 degrees, humidity 32 percent. These are simulated values." }
        else if question.lowercased().contains("route") || question.lowercased().contains("safe") { text = "Exercise only. No verified routes or road closures are available. Ash cannot establish a safe route." }
        else { text = "Exercise only. Your Garraf briefing is ready. Modelled wind is 18 kilometres per hour from the southwest. Two simulated thermal detections need review. Fire spread and road closures are unverified." }
        return AshReply(mode: "demo", topic: "Exercise briefing", answer: text, generatedAt: ISO8601DateFormatter().string(from: Date()), weather: weather, hotspots: 2, sources: [.init(source: "Ginger exercise", status: "demo", retrievedAt: "Bundled scenario", detail: "Simulated data for exploring Ash. No live incident or crew locations.")], missing: ["Validated fire perimeter", "Verified road closures", "Live crew locations"])
    }
}
struct ConversationTurn: Identifiable {
    let id = UUID()
    let question: String
    let reply: AshReply
}

enum GingerClient {
    static func endpoint(_ address: String) throws -> URL {
        guard let base = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)), let host = base.host, base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
              base.scheme == "https" || (base.scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host.hasSuffix(".local"))) else { throw ClientError.message("Use HTTPS, or http://localhost:3003 for the simulator. Local devices can use a .local hostname.") }
        return base.appending(path: "api/ash")
    }
    static func ask(_ question: String, sector: Sector, address: String, fix: PositionFix? = nil, token: String = "") async throws -> AshReply {
        var request = URLRequest(url: try endpoint(address), timeoutInterval: 65)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["question": question, "lat": sector.lat, "lon": sector.lon]
        if let fix { body["fix"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(fix)) }
        if !token.isEmpty { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { throw ClientError.message("Ginger could not verify a current briefing. Check the server and try again.") }
        return try JSONDecoder().decode(AshReply.self, from: data)
    }
    static func makeVoiceRequest(_ path: String, address: String, token: String, body: Data? = nil, type: String = "application/json") throws -> URLRequest {
        guard token.trimmingCharacters(in: .whitespacesAndNewlines).count >= 32 else {
            throw ClientError.message("Save your Ash access token in Connection settings before starting voice.")
        }
        let url = try endpoint(address).appending(path: "voice/" + path)
        var request = URLRequest(url: url, timeoutInterval: path == "status" ? 10 : 35)
        request.httpMethod = path == "status" ? "GET" : "POST"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue(type, forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return request
    }
    private static func voiceRequest(_ path: String, address: String, token: String, body: Data? = nil, type: String = "application/json") async throws -> Data {
        let request = try makeVoiceRequest(path, address: address, token: token, body: body, type: type)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = path == "status" ? 10 : 35
        configuration.timeoutIntervalForResource = path == "status" ? 12 : 40
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch let failure as URLError {
            if failure.code == .cancelled { throw CancellationError() }
            throw ClientError.message("Cannot reach Ginger at \(request.url?.host ?? address). Check that the server is running, both devices are on the same network, and Local Network is enabled for Ash in Settings. Try again.")
        }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
            throw ClientError.message(message?["error"] ?? "Ginger voice service is unavailable.")
        }
        return data
    }
    static func checkVoice(address: String, token: String) async throws {
        let data = try await voiceRequest("status", address: address, token: token)
        struct Status: Decodable { let configured: Bool; let provider: String }
        guard let status = try? JSONDecoder().decode(Status.self, from: data), status.configured, status.provider == "slng" else {
            throw ClientError.message("This server did not return a valid Ash voice configuration. Check the Ginger URL.")
        }
    }
    static func transcribe(_ audio: Data, address: String, token: String) async throws -> String {
        let data = try await voiceRequest("transcribe", address: address, token: token, body: audio, type: "audio/wav")
        struct Transcript: Decodable { let transcript: String }
        return try JSONDecoder().decode(Transcript.self, from: data).transcript
    }
    static func speech(_ text: String, address: String, token: String) async throws -> Data {
        try await voiceRequest("speak", address: address, token: token, body: JSONSerialization.data(withJSONObject: ["text": text]))
    }
    enum ClientError: LocalizedError { case message(String); var errorDescription: String? { if case let .message(value) = self { return value }; return nil } }
}
