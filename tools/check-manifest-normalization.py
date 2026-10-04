#!/usr/bin/env python3
import json
from pathlib import Path
from manifest_normalization.contract import check
from manifest_normalization.report import LOCK_PIN
from manifest_normalization.contract import sha
root=Path(__file__).resolve().parents[1]
result=check(root/'generated/manifest-normalization/v1.1.json',root/'generated/manifest-contract/manifest-contract-vectors.json')
assert sha((root/'generated/manifest-normalization/swift-native-lock-v1.1.json').read_bytes())==LOCK_PIN
print(json.dumps(result,sort_keys=True))
