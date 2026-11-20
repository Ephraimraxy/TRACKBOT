# Phase 4: the chatbot (TrackBot)

Builds on phases 1-3. Everything below is our modification of Megashop (MIT). The original
chatbot was a static prompt sent to a free OpenRouter model with no access to shop data; it is replaced.

## How a message is answered

```
browser -> POST /api/chat {message, history}        (session read on the SERVER)
   |  validate (zod), rate limit (20/min per user or IP)
   v
runChat:
  for provider in [DeepSeek, OpenAI, Claude]  (only those with a real key in .env)
      model <-> tools loop (max 4 rounds)       tools: search_products, get_product,
                                                       list_my_orders, track_my_order
      reject the reply if:  - provider errored / timed out (15 s)
                            - a product/order question was answered without calling a tool
                            - it states a money amount that no tool returned
      first acceptable reply wins
  if none:  rule-based bot (same tools, no AI)
```

Files: `lib/chatbot/` (`engine.ts`, `tools.ts`, `providers.ts`, `grounding.ts`, `rules.ts`, `types.ts`),
`app/api/chat/route.ts`, widget `components/common/ChatComponent.tsx`.

## Why it cannot invent prices, stock or order status

1. **Data only through tools.** Tools are read-only and run on the server. The model never touches the database.
2. **Identity comes from the session.** No tool accepts a user id; order tools use the logged-in customer from the
   server session. A forged `userId` in the request body is not part of the API, and a manipulated model that asks
   for someone else's reference gets `ORDER_NOT_FOUND` (resolved only among the caller's own orders).
3. **Customers only.** Order tools refuse anonymous visitors (`LOGIN_REQUIRED`) and admin/driver accounts (`CUSTOMERS_ONLY`).
4. **Price grounding.** Every amount in a reply must equal a number returned by a tool this turn; otherwise the reply is
   discarded and another provider (or the rule-based bot) answers. Limit: this checks money amounts, not every sentence.
   Statuses and stock are covered by the system prompt plus the rule that a product/order question must use a tool.
5. **No location leak.** The chatbot never receives GPS coordinates; it points to the tracking page.
6. **Prompt injection.** Tool results and user text are marked as data in the system prompt; the safety properties above do
   not depend on the model obeying it.
7. **Policies are not invented.** Delivery times, payments and returns are not in the data, so the bot says to contact the shop.

## Configuration (no secrets in code or chat)

- Put keys only in `.env` (git-ignored). `.env.example` lists the names: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
  (optional `*_MODEL`, `CHAT_PROVIDER_TIMEOUT_MS`). An empty or placeholder key disables that provider.
- Defaults: `deepseek-chat`, `gpt-4o-mini`, `claude-haiku-5-5`.
- With no key the bot still works in rule-based mode. Tests never need a key (providers are faked).
- `instrumentation.ts` validates the environment at server start: missing `DATABASE_URL` or `AUTH_SECRET` stops the server naming
  the variable (never the value); missing optional services only log a warning.
- Provider failures are logged on the server only; the response contains just `reply`, `source`, `usedTools`.

## Verification

- 59 chatbot tests: tools (identity and isolation), grounding, rule-based answers, engine fallback order and loops,
  provider wire formats (URL, headers, tool format, timeout, no key in errors), route (validation, rate limit, key never in response), env validation.
- Mutation check: removing the per-customer filter or the price check makes 6 of these tests fail.
- `tests/live/chat-flow.mjs`: 14 checks against the running app in rule-based mode.

## Known limits

- **The AI path has not been run against a real provider.** It is verified with a faked network only. First real run: add one
  key to `.env`, run `npm run dev`, then `node tests/live/chat-flow.mjs` (the `source` field will show the provider).
- Rule-based mode understands a fixed set of French/English phrasings; the AI path is far more flexible.
- Rate limiting is in-memory per server instance (see `lib/utils/rateLimit.ts`).
- Conversation history sent by the browser is untrusted text; it cannot change who the user is.
- Chatbot answers about delivery, payment and returns come from the owner's FAQ entries (the `Faq` table, `/api/faqs`, admin Chatbot FAQ page), added after this phase.
- The unused packages of the old chatbot (`ai`, `@openrouter/ai-sdk-provider`) were removed in the security review.

## Update: knowing the upgraded delivery features
- **Road route or estimate.** `track_my_order`, `list_deliveries`, `find_order` and `my_deliveries` now return `timeLeftKind`
  (`road_route` or `straight_line_estimate`). The system prompt forbids presenting an estimate as a road route or inventing
  turn-by-turn directions, and the rule-based fallback says "rough estimate, not a road route" for an estimate.
- **Stale position.** `track_my_order` returns `lastPositionSecondsAgo` and `positionLooksOutOfDate` (over 60 s while out for
  delivery). The assistant says the position and the time left may be out of date.
- **New owner-only tool `delivery_report`** (read-only): time, distance, speed, GPS points, stops, signal gaps, late points,
  whether the delivery person left the planned road, plain-language findings and the replay page. It uses the same
  owner-only report as the replay page and is refused for customers, delivery people and visitors (`ADMIN_ONLY`,
  `LOGIN_REQUIRED`); it is not even offered to those roles.
- **Prompt** now covers the full flow including Received, the map buttons and the LIVE / "Last seen" badges, the owner's
  Replay and Analytics pages, blur at close zoom, and what to tell delivery people when the signal drops.
- Tests: `tests/chatbotUpgrade.test.ts`. User-facing guide: `docs/user-guide.md`.
- Owner-only tool `payment_issues` (read-only): open wrong-amount, double-payment, dispute and refund items, in naira. Refused for customers, delivery people and visitors; never described to them. See `docs/payment-issues.md`.
- Translations: Spanish and French added for all the new interface text and the two new fallback-bot sentences; Hausa, Igbo and Yoruba fall back to English.
