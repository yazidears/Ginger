"""Fetch only the two numerical tables from CSIRO's versioned ZIP using HTTP ranges.

No photographs or large archive download. Standard-library only; fails closed if
the server ignores ranges. The immutable collection version and file hashes are
recorded alongside the original, unmodified CSVs.
"""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1] / "data/ginger-o1/annaburroo"
API = "https://data.csiro.au/dap/ws/v2/collections/60062"


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=30) as r:
        return json.load(r)


class RangeFile(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.pos = url, size, 0

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset + (self.pos if whence == 1 else self.size if whence == 2 else 0)
        if self.pos < 0:
            raise ValueError("Negative seek")
        return self.pos

    def read(self, n=-1):
        n = min(self.size - self.pos, n if n >= 0 else self.size - self.pos)
        if n <= 0:
            return b""
        if n > 4_000_000:
            raise ValueError("Refusing unexpectedly large range")
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{self.pos+n-1}"})
        with urllib.request.urlopen(request, timeout=45) as r:
            if r.status != 206:
                raise ValueError("Server did not honor bounded range request")
            data = r.read(n + 1)
        if len(data) != n:
            raise ValueError("Incomplete or oversized range")
        self.pos += n
        return data


def main():
    metadata = get_json(API)
    files = get_json(API + "/data")
    archive = next(f for f in files["file"] if f["filename"].endswith(".zip"))
    ROOT.mkdir(parents=True, exist_ok=True)
    records = []
    with zipfile.ZipFile(RangeFile(archive["presignedLink"]["href"], archive["fileSize"])) as z:
        for name in ("Plot_Average_Data.csv", "Burn_Period_Data.csv"):
            matches = [i for i in z.infolist() if Path(i.filename).name.lower() == name.lower()]
            if len(matches) != 1 or matches[0].file_size > 4_000_000:
                raise ValueError(f"Missing, ambiguous or oversized table: {name}")
            info = matches[0]
            data = z.read(info)  # zipfile also verifies the member CRC.
            (ROOT / name).write_bytes(data)
            records.append({"file": name, "archiveMember": info.filename, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            print(f"Fetched {name}: {len(data)} bytes")
    manifest = {"collection": "https://data.csiro.au/collection/csiro:60062", "metadataEndpoint": API, "version": metadata["versionNumber"],
                "archive": archive["link"]["href"], "archiveBytes": archive["fileSize"],
                "retrievedAt": datetime.now(timezone.utc).isoformat(), "license": metadata["licence"],
                "attribution": metadata["attributionStatement"], "files": records}
    (ROOT / "source.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
