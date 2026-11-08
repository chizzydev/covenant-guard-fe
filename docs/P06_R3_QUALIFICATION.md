# R3 qualification: evidence requirements for flagship cutover

1. The same Fe ingot (`covenant_transition::Guard3`) powers three independently compiled consumers: allocation pilot, governance registry, and new flagship. Its prior immutable core sections are byte-for-byte preserved, with only new interpreter/helper methods and tests added.
2. The flagship adapter never writes its `engine:Guard3` except once in `init`; all later setters delegate to the library. This is a source-level assumption, supported by test inventory and later reviewer audit.
3. All normal routes: `commit`, `commitMigration`, `commitActions`, `commitGoalActions`, `commitIncidentActions`. Additional guardian routes: `activateProgressive`, `activateContain`, `releaseIncidentBound`. No unbound release and no `earlyInvalid` exposed.
4. P06-R3 tests: Fe library 15, original P04 consumer 37, P05 allocation 4, P05 governance 4, original v1.8 34, new flagship 4 = 98. Node: legacy 31, guard EVM 6, guard HTTP 2, flagship direct EVM 2 = 41.
5. Rejection tests must compare exact pre/post **protected** state, including incident phase/ID/deficits for the new Node gate. Failed transactions must not increment revision.
6. Critical R4 engineering remaining: one authoritative EVM instance for all allocation features; parser/update action mask translation; authoritatively stored incident in the 7-view incident desk; guardian UI & evidence; lifecycle/recovery planner; all 7 views and public paths; existing Node test semantic parity; no false final completion claims.
7. R3 is an isolated qualification release, not a public `main` update. It never uses chain RPC or real keys.
