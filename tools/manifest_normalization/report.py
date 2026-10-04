"""Active manifest ledger checker with an explicit four-case amendment.
Frozen input guards/error projections are supplied by the caller. No runtime
answer is constructed; actual native fields must match every expected field.
"""
import json
from pathlib import Path
from .contract import check, bytes_for, PROFILE_ID, VERSION, CORRECTED_IDS

LOCK_PIN = "7c2ebd3fd8e360fcece519c48165549b59e18666ee9b407360cd55749fe9a700"

def manifest_report_check(path, reference, raw):
    require, sha, ids_sha = raw.require, raw.sha, raw.ids_sha
    read_json, fields, pending_input = raw.read_json, raw.fields, raw.pending_input
    strings, same, projection = raw.strings, raw.same, raw.projection
    check_identity, normalized = raw.check_identity, raw.normalized
    VECTORS_SHA, LOCK_SHA, ALL_SHA = raw.VECTORS_SHA, raw.LOCK_SHA, raw.ALL_SHA
    ELIGIBLE_SHA, PENDING_SHA = raw.ELIGIBLE_SHA, raw.PENDING_SHA
    reference = Path(reference)
    summary = check(reference / "manifest-normalization-v1.1.json", reference / "manifest-contract-vectors.json")
    profile = read_json((reference / "manifest-normalization-v1.1.json").read_bytes())
    amendments = {r["id"]:r for r in profile["archiveCorrections"]}
    lock = read_json((reference / "manifest-normalization-swift-native-lock-v1.1.json").read_bytes())
    require(sha(bytes_for(lock)) == LOCK_PIN, "Manifest normalization native receipt lock differs")
    require(lock["profileSHA256"] == summary["artifactSHA256"], "Normalization lock profile differs")
    STRICT_SHA, PROJECTED_SHA, NATIVE_LEDGER_SHA = lock["strictIDsSHA256"], lock["projectedIDsSHA256"], lock["nativeLedgerSHA256"]
    reference = Path(reference)
    vector_bytes = (reference / "manifest-contract-vectors.json").read_bytes()
    lock_bytes = (reference / "manifest-contract-lock.json").read_bytes()
    require(sha(vector_bytes) == VECTORS_SHA and sha(lock_bytes) == LOCK_SHA, "Manifest contract archive digest differs")
    archive = read_json(vector_bytes)
    lock = read_json(lock_bytes)
    require(archive["jsCommit"] == lock["jsCommit"] == "617670da887b0c684e2589882447b6b93297f2f7" and lock["vectorsSHA256"] == VECTORS_SHA, "Manifest source pin differs")
    rows = archive["cases"]
    require(len(rows) == 499 and ids_sha([row["id"] for row in rows]) == ALL_SHA, "Manifest full inventory differs")
    report = read_json(Path(path).read_bytes())
    fields(report, {"scope", "nativeMappingsRatified", "status", "totalCases", "eligibleIDs", "eligibleIDsSHA256", "runtimePassed", "strictNativeEqualIDs", "projectedMatchedIDs", "failed", "pendingCarriers", "pendingObservations", "observations", "adaptationObservations", "behaviorProfileID", "behaviorProfileVersion", "behaviorProfileSHA256", "archiveCorrectionIDs", "historicalAgreementIDs"})
    require(report["scope"] == "native-manifest-validation-identity-planning-v1.1" and report["nativeMappingsRatified"] is False and report["status"] == "passed" and type(report["totalCases"]) is int and report["totalCases"] == 499 and report["failed"] == [], "Report scope/status differs")
    require(report["behaviorProfileID"] == PROFILE_ID and report["behaviorProfileVersion"] == VERSION and report["behaviorProfileSHA256"] == summary["artifactSHA256"], "Manifest behavior profile differs")
    require(report["archiveCorrectionIDs"] == CORRECTED_IDS, "Manifest correction inventory differs")
    pending = {row["id"]: pending_input(row) for row in rows if pending_input(row) is not None}
    eligible = [row["id"] for row in rows if row["id"] not in pending]
    require(len(eligible) == 468 and ids_sha(eligible) == ELIGIBLE_SHA and len(pending) == 31 and ids_sha(sorted(pending)) == PENDING_SHA, "Input-derived native eligibility differs")
    require(report["eligibleIDs"] == eligible and report["runtimePassed"] == eligible and report["eligibleIDsSHA256"] == ELIGIBLE_SHA, "Report native inventory differs")
    for collection in ["observations", "adaptationObservations", "pendingCarriers", "pendingObservations"]:
        require(type(report[collection]) is list and all(type(item) is dict and type(item.get("id")) is str for item in report[collection]), "Invalid report ledger")
        ids = [item["id"] for item in report[collection]]
        require(ids == sorted(set(ids)), "Duplicate or unsorted ledger IDs")
    require([item["id"] for item in report["observations"]] == eligible, "Native observation ledger omitted an ID")
    row_by_id = {row["id"]: row for row in rows}
    strict, projected, adaptations, native_receipts = [], [], [], []
    for item in report["observations"]:
        fields(item, {"id", "rules", "nativeObservationJSON", "referenceObservationJSON", "comparisonObservationJSON"}, {"difference", "amendedReferenceObservationJSON"})
        require(item.get("difference") is None and strings(item["rules"]), "Invalid observation rules/difference")
        require(all(type(item[name]) is str for name in ["nativeObservationJSON", "referenceObservationJSON", "comparisonObservationJSON"]), "Observation must retain encoded JSON")
        row = row_by_id[item["id"]]
        native = read_json(item["nativeObservationJSON"], lexical=True)
        expected = read_json(json.dumps(row["expected"]), lexical=True)
        require(same(read_json(item["referenceObservationJSON"], lexical=True), expected), "Reference observation differs from immutable oracle: " + item["id"])
        if item["id"] in amendments:
            expected = read_json(json.dumps(amendments[item["id"]]["expected"]), lexical=True)
            require(type(item.get("amendedReferenceObservationJSON")) is str and same(read_json(item["amendedReferenceObservationJSON"], lexical=True), expected), "Amended observation differs: " + item["id"])
        else:
            require(item.get("amendedReferenceObservationJSON") is None, "Undeclared manifest amendment")
        compared, rules = projection(row, native)
        require(item["rules"] == rules, "Unregistered or omitted projection rule: " + item["id"])
        require(same(read_json(item["comparisonObservationJSON"], lexical=True), compared), "Comparison is not derived from actual native fields: " + item["id"])
        require(same(compared, expected), "Actual native comparison differs: " + item["id"])
        if same(native, expected):
            strict.append(item["id"])
        else:
            projected.append(item["id"])
        if rules:
            adaptations.append(item)
        if native["outcome"] == "returned" and row["operation"] in {"computeCatalogIdentity", "identityForManifest"}:
            check_identity(native["value"])
        native_receipts.append(item["id"] + "\n" + normalized(native) + "\n")
    require(report["historicalAgreementIDs"] == [id for id in eligible if id not in amendments], "Historical agreement inventory differs")
    native_sha = sha("".join(native_receipts).encode())
    require(native_sha == NATIVE_LEDGER_SHA, "Complete native observation receipt differs: " + native_sha)
    require(len(strict) == 162 and ids_sha(strict) == STRICT_SHA and report["strictNativeEqualIDs"] == strict, "Strict native-equal inventory differs")
    require(len(projected) == 306 and ids_sha(projected) == PROJECTED_SHA and report["projectedMatchedIDs"] == projected, "Projected inventory differs")
    require(report["adaptationObservations"] == adaptations and [item["id"] for item in adaptations] == projected, "Adaptation ledger omitted or changed observations")
    require([item["id"] for item in report["pendingCarriers"]] == sorted(pending) and [item["id"] for item in report["pendingObservations"]] == sorted(pending), "Pending ledger omitted an ID")
    for carrier, observation in zip(report["pendingCarriers"], report["pendingObservations"]):
        fields(carrier, {"id", "category", "evidence"})
        fields(observation, {"id", "referenceObservationJSON", "reason"}, {"nativeObservationJSON"})
        category, evidence = pending[carrier["id"]]
        require(carrier["category"] == category and carrier["evidence"] == observation["reason"] == evidence, "Pending guard evidence differs")
        require(observation.get("nativeObservationJSON") is None, "Frozen typed pending carrier must not fabricate a native call")
        require(same(read_json(observation["referenceObservationJSON"], lexical=True), read_json(json.dumps(row_by_id[carrier["id"]]["expected"]), lexical=True)), "Pending reference observation changed")
    return {"status": "passed", "scope": report["scope"], "totalCases": 499, "eligibleCases": 468,
            "strictNativeEqualCases": 162, "projectedMatchedCases": 306, "pendingCases": 31,
            "eligibleIDsSHA256": ELIGIBLE_SHA, "strictNativeEqualIDsSHA256": STRICT_SHA,
            "projectedMatchedIDsSHA256": PROJECTED_SHA, "pendingIDsSHA256": PENDING_SHA,
            "nativeObservationLedgerSHA256": native_sha, "vectorsSHA256": VECTORS_SHA, "lockSHA256": LOCK_SHA,
            "nativeMappingsRatified": False, "behaviorProfileID": PROFILE_ID, "behaviorProfileVersion": VERSION, "historicalAgreementCases": 464, "archiveCorrectionIDs": CORRECTED_IDS}


def normalization_report_check(path, reference, raw):
    reference=Path(reference)
    summary=check(reference/'manifest-normalization-v1.1.json',reference/'manifest-contract-vectors.json')
    profile=raw.read_json((reference/'manifest-normalization-v1.1.json').read_bytes())
    report=raw.read_json(Path(path).read_bytes())
    raw.fields(report,{'scope','profileVersion','profileSHA256','status','totalCases','passedIDs','failed','observations'})
    rows=profile['cases']; ids=[r['id'] for r in rows]
    raw.require(report['scope']==PROFILE_ID and report['profileVersion']==VERSION and report['profileSHA256']==summary['artifactSHA256'], 'Normalization report identity differs')
    raw.require(report['status']=='passed' and type(report['totalCases']) is int and report['totalCases']==len(rows)
        and report['passedIDs']==ids and report['failed']==[], 'Normalization runtime inventory differs')
    raw.require(type(report['observations']) is list and len(report['observations'])==len(rows), 'Normalization observations omitted')
    for row,item in zip(rows,report['observations']):
        raw.fields(item,{'id','rules','nativeObservationJSON','referenceObservationJSON','comparisonObservationJSON'}, {'difference'})
        raw.require(item['id']==row['id'] and item.get('difference') is None, 'Normalization observation ID/difference differs')
        native=raw.read_json(item['nativeObservationJSON'],lexical=True)
        expected=raw.read_json(json.dumps(row['expected']),lexical=True)
        raw.require(raw.same(raw.read_json(item['referenceObservationJSON'],lexical=True),expected), 'Normalization reference differs')
        compared,rules=raw.projection(row,native)
        raw.require(rules==item['rules'] and raw.same(raw.read_json(item['comparisonObservationJSON'],lexical=True),compared)
            and raw.same(compared,expected), 'Actual normalization observation differs: '+row['id'])
        if row['operation']=='roundTrip': raw.check_identity(native['value']['identity'])
    return {**summary,'scope':PROFILE_ID,'observations':len(rows)}


def negative_controls(path, reference, raw, *, archive_report=False):
    import copy
    import tempfile
    checker=manifest_report_check if archive_report else normalization_report_check
    control=checker(path,reference,raw); original=raw.read_json(Path(path).read_bytes())
    def alter_native(v):
        item=v['observations'][0]; obs=raw.read_json(item['nativeObservationJSON']);obs['unexpected']=True
        item['nativeObservationJSON']=json.dumps(obs)
    def alter_ref(v):
        v['observations'][0]['referenceObservationJSON']='null'
    mutations={
        'status':lambda v:v.update(status='failed'), 'count':lambda v:v.update(totalCases=True),
        'unknown-field':lambda v:v.update(extra=True),'omitted-observation':lambda v:v['observations'].pop(),
        'duplicate-id':lambda v:v['observations'].__setitem__(1,copy.deepcopy(v['observations'][0])),
        'native-field':alter_native,'reference':alter_ref,
        'comparison':lambda v:v['observations'][0].update(comparisonObservationJSON='null'),
        'failure-hidden':lambda v:v['failed'].append({'id':'invented','detail':'failed'}),
    }
    if archive_report:
        mutations.update({
            'profile':lambda v:v.update(behaviorProfileVersion='1.0.0'),
            'profile-pin':lambda v:v.update(behaviorProfileSHA256='0'*64),
            'historical-claim':lambda v:v.update(historicalAgreementIDs=v['runtimePassed']),
            'correction-omitted':lambda v:v['archiveCorrectionIDs'].pop(),
            'correction-reference':lambda v:next(i for i in v['observations'] if i['id'] in CORRECTED_IDS).update(amendedReferenceObservationJSON='null'),
            'unrelated-amendment':lambda v:v['observations'][0].update(amendedReferenceObservationJSON='{}'),
            'projection-rule':lambda v:next(i for i in v['observations'] if i['rules'])['rules'].pop(),
            'pending-carrier':lambda v:v['pendingCarriers'].pop(),
            'ratify':lambda v:v.update(nativeMappingsRatified=True),
        })
    else:
        mutations.update({'profile':lambda v:v.update(profileVersion='1.0.0'),
            'profile-pin':lambda v:v.update(profileSHA256='0'*64),
            'passed-id':lambda v:v['passedIDs'].pop(),
            'projection-rule':lambda v:next(i for i in v['observations'] if i['rules'])['rules'].pop()})
    refused=[]
    with tempfile.TemporaryDirectory(prefix='lokalized-normalization-controls-') as directory:
        candidate=Path(directory)/'report.json'
        for name,mutate in mutations.items():
            altered=copy.deepcopy(original);mutate(altered);candidate.write_text(json.dumps(altered))
            try: checker(candidate,reference,raw)
            except (ValueError,KeyError,TypeError): refused.append(name)
            else: raise ValueError('Normalization corruption was accepted: '+name)
    return {**control,'negativeControls':len(refused),'refused':refused}
