# Independent performance acceptance

Reviewer: `/root/performance_review`. Date: 2026-09-28, macOS local checkout. Version: baseline `1cad978f59a2e9ebba0a243a4bd32abb30856fae` plus working changes; exact implementation SHA256 values in `review-version.json`.

## Conclusion

**Code, targeted automated acceptance and local runtime acceptance PASS. Phone 5G verification remains pending. Overall completion is not granted.** No browser, live service, or production data was modified by this reviewer.

## Independent checks

|Check|Method and expected result|Actual|
|---|---|---|
|Persistent summary/context cache|Go tests reopen SQLite and request again without original-log download; context requested separately|PASS; 2 MiB context produces default summary under 1000 bytes; reopen hit, explicit context full text|
|Authorization on cache hit|Upstream denies after a populated cache|PASS; 403, no cached output leakage; original token endpoint shares admin gate|
|Partial/missing cache lifetime|Missing not cached; incomplete SSE short TTL; expiry prevents stale read|PASS; 15-second TTL, terminal markers required for long retention|
|Source isolation|Read main/cache/metadata implementation|PASS; separate viewer DB; original metadata DB remains read-only; no second collector|
|Concurrency/parser regression|`go test ./cmd/prompt-viewer -count=1`, then `go test -race ./cmd/prompt-viewer -count=1`|PASS, 0.339s / 2.120s; previous nonstream/SSE/tool/large-log tests included|
|Partial Session rendering|RequestBrowser tests|PASS; groups appear without automatic historical paging; partial grouping label inspected|
|Input/output, context, 50 Unicode preview|RequestBrowserConversation tests and code|PASS; input/output, expanded state retained, full context requested only when opened, 50 emoji boundary|
|More than one page of new requests|Actual UsagePage mocked API integration|PASS; 70 new rows across two pages, original history cursor retained; separate equal-time boundary tests|
|Filter/race/preferences regression|UsagePage APIKey/logic/preferences suites|PASS; current new data wins overlap IDs; filter controller cancellation preserved|
|Timeout/retry|Code review|PASS by inspection; visible queue wait has 30s timeout, API abort handling and retry actions; no real slow-network claim|

Frontend final independent run: 7 files / **106 tests passed**, duration 1.94s. APIKey suite writes an existing `socket hang up` stderr during its mock cleanup while all assertions pass.

## Historical failures checked against baseline

`RequestEventsDetailsCard.test.tsx`: current 5 failed / 30 passed. Reviewer exported unmodified HEAD with `git archive` into a separate temporary directory and ran the same suite: identical 5 failures / 30 passes. The failures concern old heading, log button title, loading label, and Request ID visibility expectations. These are **pre-existing**, not introduced by the performance changes. Raw baseline output: `baseline-card-tests.log`. No production workspace rollback was used.

## Review loops

1. Found queued request deadline returning an empty 200 and treating any SSE output as stable cache. Backend fixed explicit 504 and terminal-marker completeness. Go tests/race passed after fix.
2. Found browser cache retaining unavailable/partial responses and missing retry in time view. Frontend now skips unavailable/no-output cache, expires other cache entries after 15 seconds, supplies retry/refresh actions and context error retry. Final targeted 106 tests passed.
3. Verified historical Card suite failures independently on unchanged HEAD; preserved failures as historical evidence.

## Runtime blocker and limits

Main Agent reports original Keeper management authentication failure (401/403) and CPA IP temporary ban, plus browser authentication-token unavailability. `before-api.json` records event index 200 (50 rows), conversation attempts 500, and unauthenticated 401. These runtime observations are **Main Agent evidence**, not reviewer-operated measurements. Therefore live large-log payload, production cache restart, actual mobile screenshot and phone 5G behavior remain unverified; DAG G/H must remain incomplete until resolved.

Refresh captures new records down through the prior newest timestamp boundary, including equal-time and more-than-50 additions. An event inserted later with an older timestamp behind that boundary is not guaranteed to appear until history is loaded or filters/reload rebuild the list. No claim of universal ingestion-order incremental sync is made. Session pagination is explicitly partial grouping of loaded requests, not complete server-side Session pagination.

## Deployed artifact (Main Agent evidence)

`deployment.json` records binary SHA256 `0ea50c130d324ea9930a8dea51cb68715df5f8d709851b3e8f0e5e9fda640946`, bundle `index-DF300fWs.js`, PID 31117, wildcard port 8319, UI 200, unauthenticated 401 and independent cache DB mode 0600. Installation is recorded separately from runtime functionality. The `/health` response was HTML and is not accepted as API health proof. G remains blocked by the upstream credentials/IP ban and browser access. No retry against banned CPA was made by this reviewer.

## Runtime revalidation round 2 (2026-09-28 10:53 CST)

User restored upstream credentials. Reviewer independently ran the existing safe probe against deployed 8319 and separately requested explicit context, without restarting services. Implementation SHA256 manifest still matches.

- `independent-after-api.json`: index 50 rows / 200 / 48,817 bytes; event 11878 default conversation 855 bytes, input 247 chars, output 194 chars, zero full-context chars, 0.002/0.001s. Probe's label `large-cold` is historical naming; these independent calls were already warm and are not claimed as cold-cache tests.
- Safe two-turn session independently returned first answer `20` and second `结果是 60（20 × 3 = 60）`, both 200; unauthenticated endpoint returned 401.
- `independent-context-api.json`: explicit `?context=1` returned 200, 1,912,234 bytes, 1,775,185 context chars, with the same input/output lengths. Production text was not printed or stored in evidence.
- Main Agent's `after-api.json` reports initial 855-byte request 0.167s and warm request 0.002s. This is distinctly attributed rather than independent cold evidence.
- Reviewer visually inspected `desktop.png`: real 8319 page shows the safe Session, second-round input and model answer 60. First round is below the captured viewport. Remaining runtime evidence is awaited before superseding overall blocked conclusion.

Previous authentication/browser blocker is historical; native Chrome now works. Phone 5G end-to-end latency remains outside independently observed evidence.

## Runtime revalidation round 3 — current effective conclusion

Reviewer read `cache-restart.json`, `after-restart-api.json`, `public-host-api.json` and independently inspected the updated original `desktop.png`.

- Desktop screenshot now shows both turns in one Session simultaneously: second input and answer 60 above first input and answer 20, in descending time order. PASS by independent visual inspection of Main Agent-captured screenshot.
- Main Agent exercised refresh while expanded and opened second-round context, observing the four-message JSON plus `max_tokens:120`. PASS based on attributed Main Agent interaction evidence and independent API/context tests; reviewer did not drive the browser.
- Restart evidence records cached row expiry and summary/context lengths unchanged before/after restart and fetch; post-restart real API requests all 200 and unauthorized 401. Together with independent reopen-DB tests, persistent cache is accepted. Service restart was performed by Main Agent.
- Public hostname from server returned 200/855 bytes/context0. This confirms hostname route only; it is not phone 5G evidence.

**Current G: local code/API/UI/cache acceptance passed; phone 5G pending user confirmation. H remains incomplete.** Previous upstream credential and browser blockers were resolved; preserve earlier failed rounds as history. Do not mark the overall DAG all green before phone confirmation. Remaining architectural limits are the documented late old-timestamp event boundary and partial loaded-request Session grouping.
