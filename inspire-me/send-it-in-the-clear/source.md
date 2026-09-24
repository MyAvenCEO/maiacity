Source: https://www.youtube.com/watch?v=5vbl5FL-nsI

Note: Data Slayer, building an HF radio bridge for Reticulum. Below are the points the report
card is built on, in the order the video makes them. Course promotion is omitted. Hardware and
personal names are rendered phonetically in the auto-transcript; where the specs are
unambiguous the likely product is noted and flagged in the report card's open questions.

---

**The premise.** A phone keeps you connected as long as you keep paying. Today's communication
passes through gatekeepers who decide what is allowed, keep a record of it, and charge for the
privilege. The goal: a network where nobody has that power over the people using it — built
from cheap low-power hardware, open source code and community-run infrastructure.

**What already works.** Meshtastic and MeshCore have proven the community mesh model and
continue to gain adoption. On a drive from central Florida to New Hampshire with a magnetic
915 MHz whip antenna on the car and a small node listening on the public Long Fast channel, the
radio picked up messages along the route; Concord, New Hampshire was very active; more than 450
nodes were seen on that one protocol over the trip.

**The three existing options for distance.** Cell towers — need a large number of them, only
economic for big telcos and ISPs. Satellite (Starlink, Garmin, Iridium) — good off-grid, but
proprietary, requiring a monthly plan, with a toll per message; a previous video hooked an
Iridium modem into Reticulum. Community mesh — real, local, genuinely owned, but serious
distance needs many nodes and enough people in between.

**The two miracles.** Cross the distance on a path we own, and do it legally.

**Why now.** The physics and sending data over radio are not new; Reticulum is, and so is who
can build with it. Radios that once cost thousands are affordable, open source networking
software can stitch different links into one network, and AI lets one stubborn person work
through problems that used to need a team.

**HF and skywave.** Under the right conditions an HF signal travels into the ionosphere,
reflects, and lands hundreds or thousands of miles past the horizon. No community nodes, no
private satellite — the atmosphere is part of the path.

**APRS.** Amateur radio already carries data: small packets with locations, weather, status and
short messages, repeated by nearby stations and plotted on maps by internet gateways. But APRS
was built for a different job, and the channel in question is VHF — good locally, not the
long-distance skywave link being attempted.

**Why Reticulum.** It is transport agnostic: LoRa, Wi-Fi, Ethernet, the internet or a custom HF
link are all just paths. So an HF bridge would not be a small new network for HF operators — it
could bridge existing Reticulum communities together, including people who never touch an HF
radio. Someone on LoRa in one town could reach someone on a different link hundreds of miles
away with HF quietly carrying the gap.

**The radio.** Described as a relatively inexpensive open-source software-defined radio rated
roughly 0 to 38.4 MHz including HF, arriving in three pieces (enclosure, main board, filter
board), connecting over Ethernet so it appears as a network device, and capable of up to 5 W.
Built around a computer rather than a microphone, so software can generate the exact data frame
and put it on the air. (Specs match the Hermes-Lite 2.)

**Antennas and tuning.** At 28 MHz the wavelength is roughly 35 feet, against about 13 inches
at 900 MHz. A centre-fed dipole was used, installed with one arm inside the office and the
other out of the window, in a concrete block house — described as far from ideal. A NanoVNA was
used to read SWR and find the centre frequency; moving the arms shifts the dip; calibration
uses open, short and load standards.

**First reception.** Listening on 21 MHz with an SDR application and decoding FT8 — a digital
mode for weak-signal work, trading a very low data rate for extremely low signal-to-noise
ratios, the same trade-off LoRa makes. The first message received came from Bogotá, Colombia,
about 1,600 miles from central Florida, possible only because it bounced off the ionosphere.
Also received: an AM broadcast at 4.84 MHz, likely WWCR out of Nashville, about 727 miles away
and transmitting at 100,000 watts.

**The licence.** Transmitting on that part of the spectrum requires a licence; receiving does
not. He studied using two amateur radio YouTube channels, then took the exam in person at a
club meetup outside Miami rather than online, and passed. At the meetup he was shown a VARA
gateway bridging HF and VHF data to the internet over Starlink — line of sight, perhaps 50
miles with a good antenna, with digipeating limited to about two hops. During the meetup the
power went out and a VHF radio on a LiFePO4 battery kept transmitting to Key Biscayne, which he
notes as a live grid-down demonstration. The FCC issued a call sign a few days later, which also
means everything transmitted is now attributable to him.

**The legal problem.** With his licence, HF data for skywave has to sit between 28 and
28.3 MHz. Frames must include his call sign and the codec must be public — both achievable.
But obscuring the meaning of communications by any means is forbidden, which includes
encryption. Reticulum does not merely use encryption: its creator, Mark, describes encryption
as gravity — cryptographic identities tell the network who destinations are, signed proofs
validate paths, and encrypted packets are what let information cross multiple hops without
trusting the nodes in between. Removing it would not make Reticulum less private; it would
break it. The one exception he found while studying is that amateur radio permits encrypted
commands used to control a satellite.

**The design solution.** Do not send the encrypted Reticulum packet over HF at all. Terminate
encryption at the gateway: messages are addressed to the gateway, which converts them into an
amateur radio frame carrying the destination LXMF address and transmits it. Anyone who hears it
can bring it back into Reticulum and forward it to its final destination. Drawbacks: spoofing
is not solved (though cryptographic signatures could still prove a message originated with a
given sender), and the long-haul HF leg is open for anyone to read. He judges that acceptable —
Meshtastic public channels have widely known keys and still have utility, APRS does something
similar, amateur radio is fundamentally open communication, and someone sending an SOS does not
care who hears it.

**The software.** He used Cursor to draft the architecture, with Crosstalk — his fork of
MeshChat — as the end-user application, describing roughly five days of work with multiple
codec versions as he changed modulation and symbol rate, added error correction, and built
benchmark tools. Rather than a native Reticulum interface over HF (which would put encrypted
frames on the air and be illegal), he built Bridge Extensions that run alongside Reticulum: a
connector for the transmitter (egress) or for an RTL-SDR (ingress). The codec was published as
a markdown file in the Crosstalk GitHub repository so anyone can decode the transmissions.

**Receive-only participation.** An RTL-SDR costs $37, cannot transmit, and needs no licence. A
Reticulum gateway listening for HF traffic can act as an ingress point, bringing anything it
hears back into the network — a pattern he compares to crowd-sourced flight tracking.

**The end-to-end test.** Four nodes. An Android phone running a plain Reticulum client with one
public TCP internet interface, as the final destination. A Raspberry Pi running Crosstalk with
that same TCP interface plus an RTL-SDR bridge extension for ingress. The transmitter running
Crosstalk with only a local TCP interface and an HF egress bridge extension. And a laptop
running Crosstalk, connected only to the transmitter, as the origin — with no path to the phone
other than over HF. Sending requires toggling a public broadcast option on the conversation,
which tells Crosstalk to hand the message to the gateway when no path exists. The message
("Crossing Tim's office") took about seven seconds of keying, was decoded by the Pi, wrapped
into a proper Reticulum packet and delivered.

**Performance.** Decoding was computationally heavy and often failed. Inspired by Ken (also
known as Frosty) building PRNS, a Rust implementation of Reticulum with a browser flasher at
prns.dev, he had the most expensive parts of the decoder ported from Python to Rust; decode
times dropped to a few seconds.

**Field testing.** For range tests a 10 metre mobile whip went on the car with magnetic mounts,
plus a GPS receiver for distance logging, while the transmitter stayed in the office on the
second floor of a concrete block house with dozens more between. The car antenna tuned to about
29 MHz rather than 28 — not ideal. Results: worked in the driveway, failed down the block. 1 mW
worked, 10 mW worked, then a wall — above 300 mW the radio became unstable and packets stopped
getting through, traced to an inadequate power brick. A proper ham power bank (5 A constant,
7 A surge) still capped things around 2 W; he notes the AI had specifically recommended that
supply and then told him to buy another, concluding that AI is not always right and he was out
$60. He then built a control app running on the Pi, reached over a mesh VPN, to send messages,
adjust transmit power and receiver gain, and read decode results and SNR live from the car —
noting that the VPN carried only control and telemetry, while the measured packet travelled
entirely over HF. Eventually: a clean decode two miles out, not line of sight.

**The deadline.** He gave himself three weeks and a promise to ship whatever existed when the
clock ran out, against a stated habit of not shipping until things are perfect. Sunday came and
went without the skywave test. The remaining obstacle was logistical rather than technical: a
second person hundreds of miles away, on the same frequency, with the decoder, while the band
was open. He published anyway, listing what he had learned along the way — using an SDR,
reading a waterfall, listening for APRS, decoding FT8, knowing when a band closes and reopens,
verifying antenna tuning, and why touching the coax moves the centre frequency.

**The argument for why it matters.** Middlemen are not only a privacy or subscription problem;
they control what he calls our action potential. He cites the 2021 GameStop short squeeze, when
a centralised broker restricted trades — explicitly saying he is critiquing the architecture
that made it possible rather than the company, and noting the broker's hands were somewhat
forced because it could not carry infinite exposure. He contrasts this with decentralised
exchanges like Uniswap, where the website can be pressured but the protocol has no broker who
can turn off the buy button. He also cites a 2004 case in which a Chinese journalist used his
Yahoo account to send an email summarising government instructions to the media; Yahoo provided
account information that helped authorities identify him, and he was sentenced to ten years.
Yahoo's defence was that it had to obey local law — which he says is precisely the point, since
the architecture placed his identity in the hands of a middleman who could be compelled.
Silicon Valley answered this with principles such as "don't be evil"; greater still, he argues,
is "can't be evil" — using mathematics to reduce how much trust has to be placed in anyone in
the middle.

**The honest summary.** After a year of trying to escape what he half-jokingly calls the
communication cartels, he had subscribed to fibre, a mobile carrier, Starlink and now Iridium —
in trying to cancel the middleman, becoming their best customer. What was proven: the receiving
setup decoded a digital transmission from roughly 1,600 miles away, pushing beyond the horizon;
and the bridge worked end to end, with an ordinary Reticulum node reaching a licensed gateway,
the gateway transmitting a public call-sign-identified HF frame, and a receiver decoding it and
delivering it to an ordinary Reticulum node. What was not proven: that two people separated by
hundreds or thousands of miles can reach each other without a cell tower, private satellite or
anyone in between granting permission. He closes wanting a message to originate on a Reticulum
network in Germany, bounce off the sky, land in North America and bridge back in — and says he
now has to find whoever holds the other half of the test.
