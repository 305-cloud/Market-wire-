# Product

Market Wire helps a small business find spare stock after its usual supplier runs out. It works anywhere a basic phone can send a text: a bakery in Lima, a cafe in Manchester, a food stall in Nairobi or Manila.

When Mara's bakery runs out of flour at 2 pm and her usual supplier can't deliver before 6 pm, she sends one message: NEED 1 SACK FLOUR BEFORE 6PM. A bounded circle of nearby businesses gets the request privately. Ellis, two streets away, can offer a spare sack with a price and pickup place. Mara sees the offer and replies 1 to hold it. When she collects it, both sides get a receipt. If nobody local can help, Mara alone can choose to widen the request to a neighbouring circle via the coordinator. The coordinator routes it but cannot reserve stock on Mara's behalf. The room sees nothing until Mara widens.

## Stock

The catalogue lives in `src/domain/catalog.ts`. Each item has one trade unit so buyer and seller mean the same thing:

| Item | Unit |
|---|---|
| flour, rice, sugar | 25 kg sack |
| cooking gas | 13 kg cylinder |
| cooking oil | 20 litre can |
| coffee | 1 kg bag of beans |
| eggs | tray of 30 |
| milk | crate of 12 litres |

Prices are in generic credits. A seller may type a currency sign ($, €, £, ₹, ₦ and others); the market drops it and keeps the number. Messages never show a currency sign, because most are not in the GSM-7 SMS alphabet.
