# AshConnect at HackBarna — 20 September 2026

Working deadline: **14:00 Europe/Madrid**, as confirmed by the project owner.

| Partner | Concrete use in AshConnect | Verified boundary |
| --- | --- | --- |
| Mastra | Evidence-aware agent, memory, personal CONNECT pairing, opt-in updates, ACK and STOP | Actual tool-calling inference verified; Telegram CONNECT and STATUS received on the physical iPhone |
| Nebius Token Factory | OpenAI-compatible inference for the Mastra agent | Voucher redeemed; real Mastra tool-calling smoke passed using GLM-5.3-Flash |
| SLNG | Speech input and spoken briefings in native Ash | Live synthetic STT/TTS round trip passed; physical-device and deployed acceptance remain unverified |
| Galtea | Adversarial evidence and hosted model-response judging | Six self-hosted scores plus eight hosted judgments complete; quality score improves 1/2 to 2/2 in the two-case comparison |
| Vonage | WhatsApp sandbox delivery, signed/authenticated webhooks, bounded reply window | Adapter tested; dashboard credentials, sandbox enrolment and public webhook ingress pending |
| Photon / Mastra Channels | iMessage delivery | Existing adapter retained; sender/project/webhook provisioning pending |
| Deepfire / Norrsken wildfire track | Existing regional wildfire evidence and prevention context | Evidence coverage and timestamps must remain explicit; this is not official emergency dispatch |

Telegram is provisioned as `@AshConnectBot`; the sole poller runs on the private cloud VM. It uses outbound long polling and requires no public ingress. It is a delivery channel for the Mastra entry, not a separate sponsor integration. Only one transport is selected per worker.

## Event facts checked

The organizer's [event page](https://www.hackbcn.com/en/events/aisummit26) and [hackathon guide](https://picsoung.notion.site/HackBarna-AI-Summit-2026-c9cf4daf2e6c82f39af081742b857cdf) describe the partner tracks. The guide requires at least three partner technologies. Vonage's challenge specifically targets its **Video API**: the WhatsApp adapter alone should not be described as completing that challenge.

The HackBarna Discord's [Vonage channel](https://discord.com/channels/1247306537727164419/1425031386380763166) confirms dashboard sandbox testing is possible while a production registered sender is a separate step. Its [Nebius channel](https://discord.com/channels/1247306537727164419/1547237280014667786) reports manual voucher distribution after email/CRM trouble. No public promise of extra Mastra credits was confirmed in the [Mastra channel](https://discord.com/channels/1247306537727164419/1547252920544661695).

Provider secrets and the voucher itself are deliberately omitted from this document.

## Acceptance record

1. **Verified:** Nebius voucher redeemed, private key configured, actual Mastra evidence-tool smoke and bounded adversarial calls completed.
2. **Verified:** Telegram bot identity, cloud-only polling, private bridge and model access. No public webhook is required.
3. **Verified on the physical iPhone at 11:44:** public Hospital de Sant Pau demo registered in Safari, personal CONNECT link consumed in Telegram, subscription confirmation and STATUS reply received. Safari shows the conversation connected. Handset STOP and automatic change-triggered delivery remain separate from fixture tests.
4. **Verified:** real cloud scans and publications advance, including a natural timed scan at `2026-09-20T09:32:07.655Z` without restarting the worker.
5. **Verified:** six self-hosted invariant scores and eight hosted Galtea judgments completed. See the [receipts and judge limitations](../integrations/galtea/RESULTS.md).

See [implementation and test evidence](ash-connect.md), [SLNG evidence](ashconnect-slng-evidence.md), and [private cloud operation](deployment/GOOGLE-CLOUD.md).
