# Vocabulary

Trader phrase to command mapping (to be extended after field visits). Traders type in their own language and shorthand; the reader in `src/parser/lexicon.ts` maps it to the canonical commands below.

| Trader phrase | Command |
|---|---|
| done | collect |
| done o | collect |
| DONE | collect |
| Done. | collect |
| widen | widen |
| WIDEN | widen |
| cancel | cancel |
| stop | stop |
| help | help |
| 1 | accept (offerRef=1, ambiguous if multiple open) |
| 1. | accept (offerRef=1) |
| 1 E7 | accept (code=E7, offerRef=1) |
| 1 e7 | accept (code=E7, offerRef=1) |
| WIDEN e7 | widen (code=E7) |
| WIDEN E7 | widen (code=E7) |

## Other languages

The reader also understands common words for the commands and the catalogue items. It turns them into the canonical command and, when it is unsure, asks the trader to reply YES first.

| Trader phrase | Canonical |
|---|---|
| necesito 1 saco de harina antes 5pm (Spanish) | NEED 1 SACK FLOUR BEFORE 5PM |
| preciso 1 botijão de gás antes 6pm (Portuguese) | NEED 1 CYLINDER GAS BEFORE 6PM |
| besoin 2 sacs de riz avant 6pm (French) | NEED 2 SACK RICE BEFORE 6PM |
| nahitaji 1 gunia sukari kabla 4pm (Swahili) | NEED 1 SACK SUGAR BEFORE 4PM |
| 1 bori atta chahiye 5pm se pehle (Hindi/Urdu) | NEED 1 SACK FLOUR BEFORE 5PM |
| abeg i need 1 tray egg b4 6 (Pidgin) | NEED 1 TRAY EGGS BEFORE 6 |
| cancelar / annuler / ghairi | CANCEL |
| ayuda / aide / ajuda / msaada | HELP |
