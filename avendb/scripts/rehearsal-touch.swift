// Compile together with vault/app/enclave/Enclave.swift. This wrapper only uses
// the existing sign operation; it cannot create keys or change account metadata.
// Stdout is a private process pipe consumed by the rehearsal test, never a log.
import Foundation
@main struct RehearsalTouch {
    static func main() {
        do {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            guard var ask = try JSONSerialization.jsonObject(with: data) as? [String: Any], ask["make"] == nil else { exit(2) }
            for field in ["sign", "key", "kem", "sealed"] {
                guard let hex = ask[field] as? String, hex.count % 2 == 0 else { exit(2) }
                var decoded = Data()
                var at = hex.startIndex
                while at < hex.endIndex {
                    let end = hex.index(at, offsetBy: 2)
                    guard let byte = UInt8(hex[at..<end], radix: 16) else { exit(2) }
                    decoded.append(byte); at = end
                }
                ask[field] = decoded.base64EncodedString()
            }
            ask["why"] = "validate the avenDB upgrade on a disposable copy of your store"
            let input = try JSONSerialization.data(withJSONObject: ask)
            let result = answer(to: String(decoding: input, as: UTF8.self))
            FileHandle.standardOutput.write(Data(result.utf8))
        } catch { exit(2) }
    }
}
