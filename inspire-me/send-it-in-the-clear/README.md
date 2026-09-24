---
title: To own the network, he had to send it in the clear
originalTitle: "The Open Source Internet Is Here"
source: https://www.youtube.com/watch?v=5vbl5FL-nsI
type: video
author: Data Slayer
authorUrl: https://www.youtube.com/@DataSlayerMedia
added: 2026-09-24
categories: [internet, privacy, code]
hook: >-
  His first decoded message arrived from Bogotá, sixteen hundred miles away, on a dipole with
  one arm lying across his office floor and the other dangling out of the window.
shift:
  from: Long-range communication needs infrastructure somebody else owns — a telco, a satellite operator, an ISP.
  to: The atmosphere can be the backhaul, and a licensed radio plus a $37 receiver can bridge independent networks — if you design around the law instead of against it.
quote: "In Reticulum, encryption is gravity."
quoteBy: Mark, Reticulum's creator
---

## The story

There is a dipole antenna in this story with one arm lying on an office floor and the other hanging out of a window, in a concrete block house in central Florida. The first message it decoded came from Bogotá. Sixteen hundred miles, over the curve of the earth.

That is the whole premise, proven accidentally: the ionosphere will carry your data if you ask it properly.

The question underneath is older and less technical. Every long-range option available today runs through somebody who can say no. Cell towers are only economic for large carriers. Satellite services — Starlink, Garmin, Iridium — are proprietary, need a monthly plan, and charge per message. Community mesh networks like Meshtastic and MeshCore genuinely belong to the people using them, but covering real distance needs enough nodes, and enough people in between.

He has the data on that last point, from a drive from central Florida to New Hampshire with a magnetic whip antenna stuck to the car roof and a small node listening on the public channel. Over the trip it saw more than 450 nodes. Concord was busy enough to feel like a city. It is real, and it is also exactly as far as the volunteers reach.

So the gap he set out to cross is the one between two of those communities, hundreds of miles apart, with nobody's infrastructure in the middle. Two miracles, as he puts it: cross the distance on a path we own, and do it legally.

The first miracle is physics, and amateur radio has had it for a century. An HF signal can leave the antenna, meet the ionosphere and come back down hundreds or thousands of miles past the horizon. Skywave. There is no chain of nodes; the atmosphere is the path. What is new is Reticulum — an open, permissionless network that is transport agnostic, meaning it treats LoRa, Wi-Fi, Ethernet, the internet or a homemade HF link all as the same thing: a path. Which means an HF bridge would not create another small island for radio hobbyists. It could join Reticulum communities that already exist, for people who never touch a radio.

The second miracle nearly killed it.

Amateur radio forbids obscuring the meaning of your transmissions. No encryption. And Reticulum is not a network that happens to use encryption — cryptographic identities are how destinations are named, signed proofs are how paths are validated, and encrypted packets are what let data cross hops it does not trust. Strip that out and you do not get a less private Reticulum. You get no Reticulum.

The way through is almost embarrassingly simple once you see it, and it is a design decision rather than a technical trick: do not put the encrypted packet on the air at all. A message is addressed to the gateway. The gateway decrypts it, rewrites it as a plain amateur-radio frame carrying the final destination address and the operator's call sign, and shouts it. Anyone who hears it can pull it back into Reticulum and forward it the rest of the way. The long-haul leg is public — readable by anybody with the published codec — and that is the cost.

He argues it is an acceptable one, and the argument holds: Meshtastic's public channels use keys everybody knows and are still useful, APRS has been sending open packets for decades, and if you are lost in the mountains you do not much care who else hears the distress call.

Keeping it legal also meant sitting a licence exam, which he did in person at a club meetup outside Miami rather than online, and publishing the codec as a file in the repository so anybody can decode what he transmits. Both of those are the point rather than paperwork — a network you own is one where the rules that constrain you are visible.

The office test worked. Four nodes: a phone running an ordinary Reticulum client with no radio at all, a Raspberry Pi with a $37 receive-only dongle acting as an ingress, the transmitter, and a laptop with no path to the phone except through the sky. Seven seconds of keying, and the message arrived.

Then the field, where everything is worse. The car antenna tuned to 29 MHz instead of 28. One milliwatt worked; ten milliwatts worked; above three hundred milliwatts the radio destabilised, which turned out to be the power supply, and the replacement recommended to him by an AI did not fix it either — the same AI then told him to buy a third. He ported the expensive parts of the decoder from Python to Rust to get decode times down to seconds. He built a whole second app so he could drive around and see results live instead of driving home to find out. And he got a clean decode two miles out, through neighbourhoods, not line of sight.

Two miles. Not sixteen hundred.

The deadline he had given himself was three weeks, and the promise attached to it was that he would publish whatever existed when the clock ran out. Sunday came and went without the skywave test, because the last obstacle was not technical — it was needing a second person, hundreds of miles away, on the right frequency, when the band was open, running software finished days earlier.

So he shipped it unfinished, which is the part worth copying.

And the honest closing admission is the best line in it: after a year of trying to escape what he calls the communication cartels, he had subscribed to fibre, a mobile carrier, Starlink and Iridium. In trying to cancel the middleman, he had become their best customer.

The reason it still matters is not privacy or the bill. It is that a middleman can say no. He points at the 2021 short squeeze, where a broker restricted trading and people discovered someone was standing between them and the market — while being careful to say the criticism is of the architecture, not the company, since the broker's own constraints forced its hand. And at a 2004 case where a journalist's email account identified him to his government, because the provider held the data and was obliged to hand it over.

Which is the whole argument, compressed: *don't be evil* is a promise, and *can't be evil* is a structure.

## Key numbers

| Thing | Number |
| --- | --- |
| First decoded HF message, Bogotá to central Florida | ~1,600 miles |
| Mesh nodes seen on one drive, Florida to New Hampshire | 450+ |
| Receive-only SDR dongle | $37 |
| Licensed HF data band used (US Technician) | 28–28.3 MHz |
| Wavelength at 28 MHz vs 900 MHz | ~35 ft vs ~13 in |
| Transmit power that worked in the field | 1 mW – ~1 W |
| Power above which the radio destabilised | 300 mW (power supply fault) |
| Clean decode achieved in the field | 2 miles, not line of sight |
| Self-imposed deadline | 3 weeks |

## Beliefs that shift

- *Covering distance means buying access to somebody's infrastructure.* → The ionosphere is not owned, and the hardware to use it now costs less than a phone.
- *Encryption everywhere is always the right answer.* → Where the law forbids it, terminating it at a gateway and publishing the codec buys a public long-haul leg you could not otherwise have.
- *Ship when it works.* → He shipped a project that had not reached its own goal, and the failure is more useful than another month of silence would have been.

## What we learn

- **Transport agnostic is the whole trick.** Because Reticulum treats every link as just a path, one person's radio extends the reach of an entire mesh. Nobody else has to own the hardware.
- **Design around the constraint, not against it.** The legal wall was absolute. Moving the encryption boundary to the gateway turned an impossibility into a trade-off with a known cost.
- **Publish the codec.** Making the encoding public is what keeps it lawful, and it is also what lets strangers build receivers. The compliance requirement and the network effect are the same act.
- **Receive-only nodes are free participation.** Listening needs no licence, so a $37 dongle can be an ingress point for a whole community — the same pattern as crowd-sourced flight tracking.
- **Check the power supply first.** Two of the three weeks' worth of mysterious range failures were a power brick, and an AI confidently recommended the wrong replacement.
- **Build the test harness.** A remote control-and-telemetry app turned every experiment from a round trip into a glance. The measured packet still went entirely over the air.
- **Name the irony out loud.** Admitting he had subscribed to four middlemen while trying to escape them is what makes the rest of the argument credible.

## Open questions

- The skywave test — the actual goal — was never run. Until two stations hundreds of miles apart bridge a live Reticulum message, this is a proven receiver and a proven gateway, not a proven link.
- The radio is rendered phonetically throughout the transcript. The described specs — open source, Ethernet-attached, roughly 0–38.4 MHz, main board plus filter board, about 5 W — match the Hermes-Lite 2. Confirm before ordering.
- The public HF leg does not solve spoofing, and he says so. Cryptographic signatures could still prove a message originated with a given sender; what that looks like in practice is unresolved.
- The 2004 case described is widely reported as that of a Chinese journalist imprisoned after a provider disclosed account data. Verify names and dates before citing it.
- For us: a self-sovereign city needs its own communication the same way it needs its own food and its own machines. This is the cheapest credible answer to *what happens when the link out is somebody else's* — and it pairs with [A civilization starter kit](/inspire-me/civilization-starter-kit), which asks the same question about hardware.
