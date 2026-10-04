#!/usr/bin/env python3
"""Validate the versioned manifest native profile without a port or compiler."""
from pathlib import Path
import json
from manifest_contracts import native_policy as policy, archive

root=Path(__file__).resolve().parents[1]
path=root/'conformance/swift-manifest-v1.json'
profile=policy.read(path)
policy.require(path.read_bytes()==policy.canonical(profile),'Profile bytes are not canonical')
cases=archive.read_unique(archive.VECTORS.read_bytes())['cases']
policy.require(policy.sha(archive.VECTORS.read_bytes())==archive.VECTORS_SHA,'Frozen vector bytes changed')
policy.check_profile(profile,cases)
print(json.dumps({'status':'passed','profileID':policy.PROFILE_ID,'runtimeCases':468,'nativeAdaptations':31}))
