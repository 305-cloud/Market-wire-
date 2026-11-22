# Market Wire V2 stress test

The assertions below define release cases for implementation. Each mock sequence uses synthetic participants.

| Case | Sequence | Required outcome |
| --- | --- | --- |
| E7 | Usual seller is out, buyer asks, local seller quotes, buyer accepts, buyer collects | Private quote and one receipt. No exception appears in the room. |
| E8 | Nobody local can help, buyer widens, coordinator routes, neighbor quotes, buyer accepts and collects | One dispatch to one neighboring circle. Buyer remains the only person who can accept. |
| Changed quote | Show buyer 4,200, change seller quote to 5,000, then deliver the buyer's delayed 1 | No hold at either price. Ask for an explicit current code. |
| Competing buyers | Offer the same physical crate to E7 and E8, accept concurrently, replay both replies | One active hold and a stable result for duplicate deliveries. A losing buyer can keep looking. |
| Unaffordable first offer | Show two quotes, buyer declines the first and accepts the second | The second offer stays available until acceptance. Exact pickup instructions appear only after acceptance. |
| Cancel in transit | Widen, queue dispatch, cancel or withdraw consent, then release the worker | No unsent invite goes out. A previously sent invite cannot produce a new hold. |
| Overlap and opt-out | A seller is in both circles, another seller opts out before send, replay dispatch | No repeat or opted-out invitation. |
| No response | Reach the useful fallback time with no confirmed pickup, then deliver a quote after cutoff | Give fallback in time to act. Late quote cannot reopen the request. |
| Isolation | Start two fresh browser sessions, attempt cross-session action, reset only one | Each visitor retains only their own state. No route to live SMS exists in demo or MCP. |
| Restart | Hold a crate, restart the server, then send DONE twice under different event IDs | State persists and collection counts once. |

Record scenario, seed, commit, runtime, expected and actual outcomes. Report simulated proof separately from real handset or field results.
