"""Recorded URL oracle provenance; offline checks need no Node installation."""
import hashlib
import json
from pathlib import Path
import subprocess

LOCK_SHA256 = "e0fa1af12b31b3750be894db9a892775b672e5d2577923b84e7c83154130cb1d"


EXPECTED_NAMES = ["libada.4.0.0.dylib", "libicudata.78.3.dylib", "libicui18n.78.3.dylib", "libicuuc.78.3.dylib", "libnode.147.dylib"]


NODE = r'''new URL('https://bücher.example/');
process.stdout.write(JSON.stringify({nodeVersion:process.version,
nodeVersions:{unicode:process.versions.unicode,icu:process.versions.icu,ada:process.versions.ada},
paths:process.report.getReport().sharedObjects.filter(path=>
/\/lib(?:node\.|ada\.|icu(?:uc|i18n|data)\.)[^/]*\.dylib$/.test(path)).sort()}));'''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_lock(reference_directory):
    raw = (Path(reference_directory) / "IDNA-Compatibility/oracle-runtime-lock.json").read_bytes()
    if sha(raw) != LOCK_SHA256:
        raise ValueError("URL oracle runtime lock digest differs")
    value = json.loads(raw)
    if (set(value) != {"formatVersion", "scope", "platform", "nodeVersion", "nodeExecutableSHA256", "nodeVersions", "libraries"}
            or value["formatVersion"] != 1 or value["nodeVersion"] != "v26.5.0"
            or value["nodeVersions"] != {"unicode": "17.0", "icu": "78.3", "ada": "4.0.0"}
            or [row["name"] for row in value["libraries"]] != EXPECTED_NAMES):
        raise ValueError("URL oracle runtime lock shape/profile differs")
    for row in value["libraries"]:
        if (set(row) != {"name", "loadedPath", "realPath", "bytes", "sha256"}
                or type(row["bytes"]) is not int or row["bytes"] <= 0 or len(row["sha256"]) != 64):
            raise ValueError("URL oracle runtime image metadata differs")
    return value


def verify_loaded(node, reference_directory):
    expected = read_lock(reference_directory)
    executable = Path(node).resolve()
    if sha(executable.read_bytes()) != expected["nodeExecutableSHA256"]:
        raise ValueError("URL oracle executable digest differs")
    run = subprocess.run([str(executable), "-e", NODE], text=True, capture_output=True, check=True)
    actual = json.loads(run.stdout)
    if actual["nodeVersion"] != expected["nodeVersion"] or actual["nodeVersions"] != expected["nodeVersions"]:
        raise ValueError("URL oracle loaded version metadata differs")
    paths = actual["paths"]
    if sorted(Path(path).name for path in paths) != EXPECTED_NAMES:
        raise ValueError("URL oracle loaded engine inventory differs")
    expected_by_name = {row["name"]: row for row in expected["libraries"]}
    observations = []
    for image in paths:
        path = Path(image).resolve()
        data = path.read_bytes()
        row = expected_by_name[path.name]
        if len(data) != row["bytes"] or sha(data) != row["sha256"]:
            raise ValueError("URL oracle loaded image digest differs: " + path.name)
        observations.append({"name": path.name, "loadedPath": image, "realPath": str(path), "bytes": len(data), "sha256": sha(data)})
    return {"status": "passed", "oracleRuntimeLockSHA256": LOCK_SHA256, "loadedImages": observations}
