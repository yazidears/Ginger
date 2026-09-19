import CoreLocation
import Observation

struct PositionFix: Codable, Equatable {
    let lat: Double
    let lon: Double
    let accuracyM: Double
    let observedAt: String
    let source: String
    var isFresh: Bool {
        guard let date = ISO8601DateFormatter().date(from: observedAt) else { return false }
        let age = Date().timeIntervalSince(date)
        return (-5...60).contains(age) && (0...1000).contains(accuracyM)
    }
}
@MainActor @Observable final class FieldLocation: NSObject, CLLocationManagerDelegate {
    var fix: PositionFix?
    var error: String?
    var tracking = false
    private let manager = CLLocationManager()
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyBest; manager.distanceFilter = 10 }
    func start() {
        tracking = true; error = nil
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.startUpdatingLocation()
        default: tracking = false; error = "Allow location access for Ash in Settings, or use a selected sector."
        }
    }
    func stop() { tracking = false; manager.stopUpdatingLocation(); manager.allowsBackgroundLocationUpdates = false; fix = nil }
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in if self.tracking { self.start() } }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let value = locations.last, value.horizontalAccuracy >= 0 else { return }
        let fix = PositionFix(lat: value.coordinate.latitude, lon: value.coordinate.longitude, accuracyM: value.horizontalAccuracy, observedAt: ISO8601DateFormatter().string(from: value.timestamp), source: "ios-core-location")
        Task { @MainActor in guard self.tracking else { return }; self.fix = fix; self.error = fix.isFresh ? nil : "Waiting for a fresh, more accurate GPS fix." }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { Task { @MainActor in self.error = "Location unavailable. Ash will not substitute another position." } }
}
