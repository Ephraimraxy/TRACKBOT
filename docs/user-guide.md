# TrackBot user guide

For the shop owner, customers and delivery people. For how it is built, see the other files in `docs/`.

## The life of an order
Pending → Processing → Shipped → Out for delivery → Delivered → Received (or Cancelled).

| Step | Who | What happens |
|---|---|---|
| Pending | customer | places the order and pays with Paystack |
| Processing, Shipped | shop owner | prepares and packs the order, then marks it Shipped and assigns a delivery person (Deliveries page) |
| Out for delivery | delivery person | taps **Start delivery**; their live location is shared with the customer and the owner |
| Delivered | delivery person | taps **Confirm delivery** at the door; sharing stops, the delivery stays open |
| Received | customer | taps **I received it**. If the customer does not, the owner can **Close as received** |

Payment is separate from these steps: Paid, Awaiting payment or Payment failed.

## Customers
- **Pin your exact spot at checkout** (tap the map or use your current location). Without a pin there is a map but no time estimate.
- **Track your order** from My orders. You see the delivery person moving, with the time left and the distance.
- **Reading the map:** **LIVE** means a position arrived in the last 30 seconds. **"Last seen N s ago"** (amber) means their phone has gone quiet (screen locked, no signal or the page closed): the time left may be out of date. When the signal returns, the missed part of the route is filled in.
- **Road route or estimate?** A dashed blue line along roads is a real route. A dotted grey line straight to your spot, with the note "Straight-line estimate", means road directions were not available: the real drive is usually longer. The time says "(estimate)".
- **Buttons:** Satellite / Street map, 3D view (tilt and rotate: right mouse button or two fingers), Full view (you and the delivery person together), Follow, Full screen.
- **Blurry when very close?** The satellite pictures only go so far. Zooming further just enlarges them.
- **Alerts:** Settings → Delivery updates: how often to be reminded, an "almost here" alert, sound.
- **Ask the assistant** (chat button): where is my order, how long is left, what happens next.

## Delivery people
- Open **Deliveries**, tap **Start delivery**, allow location. **Keep the page open and the screen on**: browsers pause location when the screen is off or you switch apps. (An Android app that keeps sharing with the screen off exists in the project but has not been released.)
- If the signal drops, your points are saved on the phone and sent when it returns ("N saved points will be sent…").
- **Navigate to the customer** opens your maps app. The time-left box says "(estimate)" when only a straight line is known; turn-by-turn directions appear only for a real road route.
- The customer's building is coloured red on the map where the map data has it.
- Tap **Confirm delivery** at the door.

## The shop owner
- **Payments to look at** (link on the Deliveries page): a wrong amount, a second payment, a dispute or a refund. Do the refund or the dispute answer in Paystack, then mark it resolved.
- **Deliveries page:** assign delivery people, **Watch live**, **Close as received**, **Replay the route** for delivered orders, and **Delivery analytics**.
- **Watch live:** the same map as the customer, plus the next turn when a road route exists.
- **Replay the route:** play or scrub the movement. Findings in plain words: GPS went quiet (gaps), vague fixes, impossible jumps (ignored), late points, stops, and whether the delivery person left the planned road.
- **Delivery analytics:** finished deliveries, average time and distance, GPS problems and detours, per delivery person.
- **Ask the assistant:** "how did delivery a1b2c3d4 go?", "who is busy?", "what is stuck?". It reads the same reports and tells you which button to press.
- **Settings in Railway:** see `docs/routing-provider.md` (road routing) and the satellite variables in `.env.example`. Variables starting with `NEXT_PUBLIC_` need a redeploy.

## What the assistant knows and refuses
- It answers prices, stock, orders and delivery status **only from the shop's data**, never from memory, and says so when it does not know.
- A customer sees only their own orders. Delivery people see only their own deliveries. Only the owner can ask for shop-wide data and delivery reports. The assistant never shows coordinates.
- It says plainly when a time is a straight-line estimate or a position may be out of date.
- It cannot refund or settle disputes. The owner can ask it about payment problems; customers should contact the shop owner.

## Known limits
- No routing provider is configured by default: times are straight-line estimates until one is set.
- The 3D buildings come from OpenStreetMap; where a house was never mapped it shows flat.
- Tracking needs the page open with the screen on (browser limit).
- Payments: wrong amounts, double payments, disputes and refunds are recorded on the **Payments to look at** page, but refunds and dispute answers are done in the Paystack dashboard (see `docs/payment-issues.md`).
