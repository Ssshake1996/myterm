"""Produce an offline installation of an already verified, self-contained release."""
import gzip
import io
import json
import sys
import tarfile

source, destination = sys.argv[1:]
changed = False
browsers = set()
with tarfile.open(source, "r|gz") as original, open(destination, "xb") as output:
    with gzip.GzipFile(fileobj=output, filename="", mode="wb", compresslevel=5, mtime=0) as gzip_output:
        with tarfile.open(fileobj=gzip_output, mode="w|", format=tarfile.PAX_FORMAT) as package:
            for member in original:
                if member.name in ("package/browser/runtime/win32-x64/runtime.json", "package/browser/runtime/linux-x64/runtime.json"):
                    browsers.add(member.name)
                content = original.extractfile(member) if member.isfile() else None
                if member.name == "package/package.json":
                    manifest = json.load(content)
                    if changed or manifest["scripts"].pop("postinstall") != "node scripts/bundle-browser-runtime.mjs":
                        raise ValueError("Unexpected installation hook")
                    raw = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
                    content = io.BytesIO(raw)
                    member.size = len(raw)
                    member.pax_headers.pop("size", None)
                    changed = True
                package.addfile(member, content)
if not changed or len(browsers) != 2:
    raise ValueError("Expected the complete dual-platform release with its browser installation hook")
