#!/usr/bin/env python3
"""Check shared native decisions offline, without a port, compiler or oracle."""
import argparse
import json
from pathlib import Path
from native_adaptations.contract import canonical, check_profile, read, read_corpus, sha

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', required=True)
    parser.parse_args()
    try:
        path = ROOT/'conformance/swift-native-v1.json'
        profile = read(path)
        check_profile(profile, read_corpus(ROOT/'generated/behavioral-vectors.json'))
        if path.read_bytes() != canonical(profile):
            raise ValueError('Native profile must retain its sorted compact UTF-8 bytes')
        print(json.dumps({'status': 'passed', 'profileID': profile['profileID'], 'profileSHA256': sha(path.read_bytes()),
            'casesWithDecisions': len(profile['records']), 'requiredNativeTypeBoundaries': 20,
            'informationalFilenameAdaptations': 5, 'informationalJVMCarriers': 159, 'releaseParity': False}))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'status': 'error', 'error': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
