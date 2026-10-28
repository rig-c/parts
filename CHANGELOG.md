# Changelog

## [1.72.1](https://github.com/rig-c/parts/compare/v1.72.0...v1.72.1) (2026-10-28)


### Bug Fixes

* **turn:** a surface mesh bound to a stopped chain resolves the stop's draw bones to their links for its setup frames ([#803](https://github.com/rig-c/parts/issues/803)) ([7e829f6](https://github.com/rig-c/parts/commit/7e829f68c9200f3492df191d667c61756b204a83)), closes [#800](https://github.com/rig-c/parts/issues/800)

## [1.72.0](https://github.com/rig-c/parts/compare/v1.71.1...v1.72.0) (2026-10-28)


### Features

* **turn:** a mesh blended across the head and body groups takes each group's turn deform by its skin weights ([#802](https://github.com/rig-c/parts/issues/802)) ([0c211ee](https://github.com/rig-c/parts/commit/0c211eed60edc13ce8b76ab49f77a53543f4b36c)), closes [#796](https://github.com/rig-c/parts/issues/796)
* **turn:** a surface role on a weighted mesh part — depth deform on top of skinning, so physics hair also turns with its depth ([#798](https://github.com/rig-c/parts/issues/798)) ([07cdd59](https://github.com/rig-c/parts/commit/07cdd59676e5f879b8b42e0b8dfdfdb7879218d4)), closes [#795](https://github.com/rig-c/parts/issues/795)


### Bug Fixes

* **docs:** name @rig-c/parts and @rig-c/core as the canonical packages in the README and the authoring guide ([#799](https://github.com/rig-c/parts/issues/799)) ([25047b4](https://github.com/rig-c/parts/commit/25047b4c3e205d5826bb44777fbf187139a91cd5))

## [1.71.1](https://github.com/rig-c/parts/compare/v1.71.0...v1.71.1) (2026-10-28)


### Bug Fixes

* **assemble:** keep the fringe and skip the seam bake between parts a turn moves relative to each other ([#794](https://github.com/rig-c/parts/issues/794)) ([eac4c00](https://github.com/rig-c/parts/commit/eac4c006d03a06f77b9659e906499b66426a1d25))
* **turn:** carry a unit part attached through config.meshes on its own carrier bone instead of skipping it ([#792](https://github.com/rig-c/parts/issues/792)) ([de9f747](https://github.com/rig-c/parts/commit/de9f74754d5d86ff44f1cd9bae0c7259f987d536))

## [1.71.0](https://github.com/rig-c/parts/compare/v1.70.1...v1.71.0) (2026-10-28)


### Features

* **turn:** the body gets depth too — a body-yaw dial projecting torso surface grids through the head's turn path ([#788](https://github.com/rig-c/parts/issues/788)) ([fa44b9a](https://github.com/rig-c/parts/commit/fa44b9a683a7dde5c2401fd872dd630880c26ad3))

## [1.70.1](https://github.com/rig-c/parts/compare/v1.70.0...v1.70.1) (2026-10-27)


### Bug Fixes

* **docs:** the depth-sheet 2.5D head turn shipped in 1.68.0; say so where the docs still called it future work ([#785](https://github.com/rig-c/parts/issues/785)) ([87fe191](https://github.com/rig-c/parts/commit/87fe1914cf80b1182c2f78c1768bac55ea71fb81))

## [1.70.0](https://github.com/rig-c/parts/compare/v1.69.0...v1.70.0) (2026-10-27)


### Features

* **rig:** a weighted waist — an explicit `waist` declaration skins the topwear hem to hip by height, not radius ([#783](https://github.com/rig-c/parts/issues/783)) ([4614896](https://github.com/rig-c/parts/commit/46148966794e8fee419117e9a929e4df46a96de3))

## [1.69.0](https://github.com/rig-c/parts/compare/v1.68.0...v1.69.0) (2026-10-27)


### Features

* **alternates:** opt-in base_anchor keeps the base attachment's placement and takes only the alternate's art ([#781](https://github.com/rig-c/parts/issues/781)) ([770dad4](https://github.com/rig-c/parts/commit/770dad49445faf6e52271ef91cfff83ef973b24f)), closes [#780](https://github.com/rig-c/parts/issues/780)

## [1.68.0](https://github.com/rig-c/parts/compare/v1.67.0...v1.68.0) (2026-10-26)


### Features

* **depth:** read See-through per-layer depth sheets into core depth references ([#774](https://github.com/rig-c/parts/issues/774)) ([9a488d0](https://github.com/rig-c/parts/commit/9a488d0e918edaeb74d1d767caa5ef6e7873b920))
* **turn:** a 2.5D head turn from depth sheets — grid surfaces, yaw/pitch dials, core projects ([#777](https://github.com/rig-c/parts/issues/777)) ([56aa2dd](https://github.com/rig-c/parts/commit/56aa2ddbeab5d7239916f8acbec0f206af0bb3e5)), closes [#763](https://github.com/rig-c/parts/issues/763)


### Performance Improvements

* **automotion:** compare candidates against one prepared motion reference (rig-c ^2.72.0) ([#778](https://github.com/rig-c/parts/issues/778)) ([91f0935](https://github.com/rig-c/parts/commit/91f09357404f0c3e4cacecd7c5c300c14cde745d)), closes [#776](https://github.com/rig-c/parts/issues/776)

## [1.67.0](https://github.com/rig-c/parts/compare/v1.66.0...v1.67.0) (2026-10-25)


### Features

* declare torso-sleeve motion seams and report posed WARN joints ([#770](https://github.com/rig-c/parts/issues/770)) ([b1f428a](https://github.com/rig-c/parts/commit/b1f428ade5efb83c3dd9ff8bf2d0df4628aab79a)), closes [#750](https://github.com/rig-c/parts/issues/750)


### Bug Fixes

* **docs:** state the cloth recipe's count units and point mesh-stats at the per-region report ([#769](https://github.com/rig-c/parts/issues/769)) ([#772](https://github.com/rig-c/parts/issues/772)) ([9e0ff71](https://github.com/rig-c/parts/commit/9e0ff7177f43447469bcf0fd37e7127ac3cda731))

## [1.66.0](https://github.com/rig-c/parts/compare/v1.65.0...v1.66.0) (2026-10-25)


### Features

* **layers:** report drawn and opaque core bounds ([#765](https://github.com/rig-c/parts/issues/765)) ([e9deea4](https://github.com/rig-c/parts/commit/e9deea40baf40c05608cdb93360b1075c452a419))


### Bug Fixes

* **check:** name chain roots below the failing part art ([#760](https://github.com/rig-c/parts/issues/760)) ([c905482](https://github.com/rig-c/parts/commit/c905482d6e4f8857a31af11e10bf1b22badcb4d1))
* close four authoring and message gaps from exam sittings ([#753](https://github.com/rig-c/parts/issues/753)) ([#756](https://github.com/rig-c/parts/issues/756)) ([d200378](https://github.com/rig-c/parts/commit/d20037851f099d283a1002a0d59ae915744c5874))
* name both --write-config rules in each refusal and list --from-config's flags ([#759](https://github.com/rig-c/parts/issues/759)) ([#764](https://github.com/rig-c/parts/issues/764)) ([8137220](https://github.com/rig-c/parts/commit/8137220435145c50adf7ebe9240c3b0fef7ca73c))
* **propose:** draft measured passing signs for shared mesh chains ([#755](https://github.com/rig-c/parts/issues/755)) ([6b3c7e2](https://github.com/rig-c/parts/commit/6b3c7e244fb4ec13786472bc6270d10d66c86c26))
* **selftest:** anchor mesh-draft's stage matches to its scratch dir ([#766](https://github.com/rig-c/parts/issues/766)) ([#768](https://github.com/rig-c/parts/issues/768)) ([cfc39b6](https://github.com/rig-c/parts/commit/cfc39b6e88a71f1585ab119d48eca32e7e4a1d1d))
* **selftest:** hold family RSS to the six GiB slot ([#767](https://github.com/rig-c/parts/issues/767)) ([1d35223](https://github.com/rig-c/parts/commit/1d3522313c71ea1b3dbcde0fb9baa929d407d0e8))
* state drift line verdict and plan-order vs input-layer behavior ([#758](https://github.com/rig-c/parts/issues/758)) ([#761](https://github.com/rig-c/parts/issues/761)) ([9df18c7](https://github.com/rig-c/parts/commit/9df18c7b55ff8b755fe7abe9654f8d4a7336e80d))
* **turn:** order turn twins by bone declaration, not mesh weight encounter ([#749](https://github.com/rig-c/parts/issues/749)) ([e6f983e](https://github.com/rig-c/parts/commit/e6f983e454a7f40fca436c43fccc5c94d60bbf80))

## [1.65.0](https://github.com/rig-c/parts/compare/v1.64.0...v1.65.0) (2026-10-25)


### Features

* **check:** report the steady-wind band each seam pair holds (--wind-band) ([#739](https://github.com/rig-c/parts/issues/739)) ([803fb36](https://github.com/rig-c/parts/commit/803fb36626301e1bec81da10aacf0e9caeea6803))
* **limbs:** add source-derived hybrid joint bands ([#747](https://github.com/rig-c/parts/issues/747)) ([0628d7b](https://github.com/rig-c/parts/commit/0628d7bc311a2b548edf7a11e8407546357d4b4d))

## [1.64.0](https://github.com/rig-c/parts/compare/v1.63.0...v1.64.0) (2026-10-25)


### Features

* **release:** gate a cut on the parts output loading in the current @rig-c/play ([#743](https://github.com/rig-c/parts/issues/743)) ([4bfd3c5](https://github.com/rig-c/parts/commit/4bfd3c53cc49c92cc7928ea943b1a7ee72283808))


### Bug Fixes

* **explicit:** let meshes.&lt;part&gt;.explicit compose with turn.depths ([#742](https://github.com/rig-c/parts/issues/742)) ([5a43dff](https://github.com/rig-c/parts/commit/5a43dff338ec6de3bb7b4fab446070414e4a949c)), closes [#740](https://github.com/rig-c/parts/issues/740)

## [1.63.0](https://github.com/rig-c/parts/compare/v1.62.0...v1.63.0) (2026-10-25)


### Features

* **engines:** raise the declared Bun floor to 1.4.0 ([#730](https://github.com/rig-c/parts/issues/730)) ([364e99e](https://github.com/rig-c/parts/commit/364e99e2e08e38ac5abe69560d2839f103475aad)), closes [#729](https://github.com/rig-c/parts/issues/729)
* **explicit:** state a part split across island slots (&lt;part&gt;__island2) ([#738](https://github.com/rig-c/parts/issues/738)) ([6e0d513](https://github.com/rig-c/parts/commit/6e0d5132cab95e0cb082f6eb401362b89fab0312)), closes [#734](https://github.com/rig-c/parts/issues/734)
* **layout:** let several placements share one stationary target slot ([#737](https://github.com/rig-c/parts/issues/737)) ([c483042](https://github.com/rig-c/parts/commit/c483042007a4d057277852c6e4af1795e97c6ba0)), closes [#657](https://github.com/rig-c/parts/issues/657)
* **selftest:** write machine-readable summary via --summary-json ([#732](https://github.com/rig-c/parts/issues/732)) ([da2a646](https://github.com/rig-c/parts/commit/da2a6463cba46361312166d62bc194432903dfd7)), closes [#725](https://github.com/rig-c/parts/issues/725)


### Bug Fixes

* **selftest:** canonicalise a missing check read through its nearest existing ancestor ([#735](https://github.com/rig-c/parts/issues/735)) ([8e1803f](https://github.com/rig-c/parts/commit/8e1803f4b21610df1fe1ffab9ced61fccb91d0b1)), closes [#733](https://github.com/rig-c/parts/issues/733)

## [1.62.0](https://github.com/rig-c/parts/compare/v1.61.0...v1.62.0) (2026-10-24)


### Features

* **sets:** an alternate set may declare an authored focus point, emitted in sets.json ([#722](https://github.com/rig-c/parts/issues/722)) ([ddc5993](https://github.com/rig-c/parts/commit/ddc599358c2ae69f353a0dc5d51606b2bcb9b811))
* transfer accepted meshes through hash-guarded explicit payloads ([#718](https://github.com/rig-c/parts/issues/718)) ([a5a2bbb](https://github.com/rig-c/parts/commit/a5a2bbbffaa2bcf5614d38cd6f20fd87e0f3bc9c)), closes [#658](https://github.com/rig-c/parts/issues/658)


### Bug Fixes

* **check:** count open root gaps and under-piece exposure ([#728](https://github.com/rig-c/parts/issues/728)) ([47c4dd1](https://github.com/rig-c/parts/commit/47c4dd1cef4f9a6b828c5547818cc9542735ecfe)), closes [#711](https://github.com/rig-c/parts/issues/711)
* **check:** retain measured seam population at zero error ([#721](https://github.com/rig-c/parts/issues/721)) ([940b3f6](https://github.com/rig-c/parts/commit/940b3f63cf58713200de1575eb1c19a0c35ab825)), closes [#716](https://github.com/rig-c/parts/issues/716)
* **release:** give each alias its own registry wait and poll the tarball too ([#727](https://github.com/rig-c/parts/issues/727)) ([6dddbb5](https://github.com/rig-c/parts/commit/6dddbb5f653a5dca0c16b083e606b9dd86e9f03d))

## [1.61.0](https://github.com/rig-c/parts/compare/v1.60.2...v1.61.0) (2026-10-24)


### Features

* **check:** gate body-root motion gaps with composite coverage ([#707](https://github.com/rig-c/parts/issues/707)) ([58122e7](https://github.com/rig-c/parts/commit/58122e77b1e28e16879564a18d5c617dc6b08729)), closes [#686](https://github.com/rig-c/parts/issues/686)


### Bug Fixes

* **check:** resolve generated body turn carriers ([#710](https://github.com/rig-c/parts/issues/710)) ([4f276e0](https://github.com/rig-c/parts/commit/4f276e0deee1915f178aa10a6803a82998befdc4)), closes [#708](https://github.com/rig-c/parts/issues/708)
* **check:** stabilize setup seams and alternate-set verdicts ([#713](https://github.com/rig-c/parts/issues/713)) ([7e71791](https://github.com/rig-c/parts/commit/7e717915799c101f3c4040c73782bc6b14dc95a5)), closes [#705](https://github.com/rig-c/parts/issues/705)
* let alternate parts select named author layers ([#712](https://github.com/rig-c/parts/issues/712)) ([62ca5b0](https://github.com/rig-c/parts/commit/62ca5b07ab1f566b6c36e85fe2196d726f58c300))
* preserve parent cutouts for independently selected alternate pieces ([#715](https://github.com/rig-c/parts/issues/715)) ([e0ac7d4](https://github.com/rig-c/parts/commit/e0ac7d4afcbb0b18b1149d4111e0686366a6ff29))

## [1.60.2](https://github.com/rig-c/parts/compare/v1.60.1...v1.60.2) (2026-10-23)


### Bug Fixes

* **build:** isolate CLI stages in sequential processes ([#690](https://github.com/rig-c/parts/issues/690)) ([c51beae](https://github.com/rig-c/parts/commit/c51beae5e98b7f3154576f42569fcb7b6941fa50)), closes [#689](https://github.com/rig-c/parts/issues/689) [#699](https://github.com/rig-c/parts/issues/699) [#693](https://github.com/rig-c/parts/issues/693) [#677](https://github.com/rig-c/parts/issues/677)
* **config:** correct clearance hints and document authoring contracts ([#703](https://github.com/rig-c/parts/issues/703)) ([7a214c9](https://github.com/rig-c/parts/commit/7a214c97af17e04298882a10416d92742acd54ca)), closes [#697](https://github.com/rig-c/parts/issues/697) [#674](https://github.com/rig-c/parts/issues/674) [#668](https://github.com/rig-c/parts/issues/668) [#534](https://github.com/rig-c/parts/issues/534) [#560](https://github.com/rig-c/parts/issues/560)
* preserve revision ancestry and register declared set anchors ([#702](https://github.com/rig-c/parts/issues/702)) ([32c9c9d](https://github.com/rig-c/parts/commit/32c9c9d621ae0c7f0127f66e1766df392d151a75))
* **propose:** resolve missing attachments against destination config ([#700](https://github.com/rig-c/parts/issues/700)) ([cc21421](https://github.com/rig-c/parts/commit/cc214211a29d0d4e9be2b1828d9967ae5c8e6a70))
* resolve installed smoke commands and canonical paths on Windows ([9efd432](https://github.com/rig-c/parts/commit/9efd432f73a5202d342c72ae9caa0c1188f3a428))
* **rig:** retain authored draw order for declared limb riders ([#704](https://github.com/rig-c/parts/issues/704)) ([cab7610](https://github.com/rig-c/parts/commit/cab7610ee9ce283f3b9fac5388e7a264af47ad76))
* **smoke:** prove Bun absent in a controlled search path ([#694](https://github.com/rig-c/parts/issues/694)) ([62158aa](https://github.com/rig-c/parts/commit/62158aa4a520a073faf2d3c7e36c7bef6e7e3c94))

## [1.60.1](https://github.com/rig-c/parts/compare/v1.60.0...v1.60.1) (2026-10-23)


### Bug Fixes

* **check:** read seams in default and still air ([#676](https://github.com/rig-c/parts/issues/676)) ([8fe6713](https://github.com/rig-c/parts/commit/8fe6713c606bc6c9aa584555b8780536ad1d37f5))
* **docs:** the examples repository is rig-c/examples (renamed from parts-examples) ([#681](https://github.com/rig-c/parts/issues/681)) ([1b37eb1](https://github.com/rig-c/parts/commit/1b37eb1fca3af9c12f7e0163fdab633eb0ebed8e))
* **selftest:** isolate public example stages in sequential children ([#688](https://github.com/rig-c/parts/issues/688)) ([2f93435](https://github.com/rig-c/parts/commit/2f934359420b6533f3ccdbc3e821d56429af2649))
* **selftest:** report process-family peak RSS on stderr ([#684](https://github.com/rig-c/parts/issues/684)) ([50e2faf](https://github.com/rig-c/parts/commit/50e2faf513ef7838e8437af47c2812d7ec2b9be2))

## [1.60.0](https://github.com/rig-c/parts/compare/v1.59.0...v1.60.0) (2026-10-23)


### Features

* **propose:** an upgrade path for configs proposed before the 1.37 arm split ([#673](https://github.com/rig-c/parts/issues/673)) ([0226fb1](https://github.com/rig-c/parts/commit/0226fb1563776c07943167bf93c9b30e9b462439)), closes [#671](https://github.com/rig-c/parts/issues/671)

## [1.59.0](https://github.com/rig-c/parts/compare/v1.58.0...v1.59.0) (2026-10-23)


### Features

* **limbs:** a limb segment's front slot for gesture sets ([#667](https://github.com/rig-c/parts/issues/667)) ([1488155](https://github.com/rig-c/parts/commit/148815520a7d484210259e343c230584f9d412ea)), closes [#664](https://github.com/rig-c/parts/issues/664)

## [1.58.0](https://github.com/rig-c/parts/compare/v1.57.1...v1.58.0) (2026-10-22)


### Features

* save proposed config fields and close first-reader gaps ([#662](https://github.com/rig-c/parts/issues/662)) ([07138f2](https://github.com/rig-c/parts/commit/07138f272ab74f36d9f7de3c3c3d59dcdcceb627))

## [1.57.1](https://github.com/rig-c/parts/compare/v1.57.0...v1.57.1) (2026-10-21)


### Bug Fixes

* **ci:** refuse push releases with mismatched provenance ([#659](https://github.com/rig-c/parts/issues/659)) ([5b7f63a](https://github.com/rig-c/parts/commit/5b7f63a2aeddd5ab1900b777bdad042aeb89848b))

## [1.57.0](https://github.com/rig-c/parts/compare/v1.56.0...v1.57.0) (2026-10-21)


### Features

* accept explicit alternate bone endpoints ([#655](https://github.com/rig-c/parts/issues/655)) ([0faeb5a](https://github.com/rig-c/parts/commit/0faeb5a131fec10882db1fa24f33eab50ad3936f)), closes [#652](https://github.com/rig-c/parts/issues/652)

## [1.56.0](https://github.com/rig-c/parts/compare/v1.55.2...v1.56.0) (2026-10-21)


### Features

* declare explicit limb layout and emit bound slot groups ([#654](https://github.com/rig-c/parts/issues/654)) ([c176b43](https://github.com/rig-c/parts/commit/c176b43f03a197e8968d864666665e7ea2cc8d9b)), closes [#647](https://github.com/rig-c/parts/issues/647)


### Bug Fixes

* coalesce explicitly bound riders into limb slot blocks ([#649](https://github.com/rig-c/parts/issues/649)) ([dab13da](https://github.com/rig-c/parts/commit/dab13da59b5c1889169a4c8dafcb6f6be7d97460)), closes [#646](https://github.com/rig-c/parts/issues/646)

## [1.55.2](https://github.com/rig-c/parts/compare/v1.55.1...v1.55.2) (2026-10-21)


### Bug Fixes

* **assemble:** assign connected footwear by its source segments ([#642](https://github.com/rig-c/parts/issues/642)) ([b0cf05f](https://github.com/rig-c/parts/commit/b0cf05f63f5a8da9d9f8bc0e6b269915cea69598))
* **assemble:** preserve assigned limb art through cover exclusions ([#644](https://github.com/rig-c/parts/issues/644)) ([c7ef313](https://github.com/rig-c/parts/commit/c7ef3139dbe244db7c8ab05013305e69a2120d45)), closes [#637](https://github.com/rig-c/parts/issues/637)

## [1.55.1](https://github.com/rig-c/parts/compare/v1.55.0...v1.55.1) (2026-10-21)


### Bug Fixes

* **propose:** --write-config --from returns a tag whose recipe was dropped to its plain draft, and counts what it returned ([#630](https://github.com/rig-c/parts/issues/630)) ([#634](https://github.com/rig-c/parts/issues/634)) ([d924c0b](https://github.com/rig-c/parts/commit/d924c0b11391fb7d59d0e82ef0702990909907ee))
* **propose:** the figure layer is chosen with the assembler's joint-line test, and a part a cloth recipe names is never taken as the figure ([#629](https://github.com/rig-c/parts/issues/629), [#631](https://github.com/rig-c/parts/issues/631)) ([#633](https://github.com/rig-c/parts/issues/633)) ([94c2d4c](https://github.com/rig-c/parts/commit/94c2d4cb55000db320cad59ee663ccce28f756c1))
* **selftest:** the check that AUTHORING's quoted fold lines match the console moves from the check suite to the tree suite ([#627](https://github.com/rig-c/parts/issues/627)) ([#636](https://github.com/rig-c/parts/issues/636)) ([8302ddc](https://github.com/rig-c/parts/commit/8302ddc246c98330e3018ca3bdcd752cccfef224))

## [1.55.0](https://github.com/rig-c/parts/compare/v1.54.0...v1.55.0) (2026-10-21)


### Features

* **assemble:** a limb set whose source layer holds both legs in one island splits it by the nearest leg segment, with the other leg posed in the set ([#609](https://github.com/rig-c/parts/issues/609)) ([#624](https://github.com/rig-c/parts/issues/624)) ([4ff7ec9](https://github.com/rig-c/parts/commit/4ff7ec913db2517ee81c12c268ce3d7f3634a4f9))
* **build:** check.json records the config the build read, its path as typed and the sha256 of its bytes, beside [#556](https://github.com/rig-c/parts/issues/556)'s requirements record ([#607](https://github.com/rig-c/parts/issues/607)) ([#621](https://github.com/rig-c/parts/issues/621)) ([7486fe0](https://github.com/rig-c/parts/commit/7486fe0b91db55ffaca1a25b2da3d5923fedee5d))
* **check:** SEAM_OVER_RANGE holds a cap_shape "ball" joint to the disc rule, over the whole disc, as it holds a "disc" joint ([#598](https://github.com/rig-c/parts/issues/598)) ([#616](https://github.com/rig-c/parts/issues/616)) ([dd54fb2](https://github.com/rig-c/parts/commit/dd54fb22962a4837001d0fcf1b2d3bac42449f93))
* **remesh:** remesh and retune can record their input check and reuse it for the same input tree, bound by every file's sha256 and the tool versions ([#617](https://github.com/rig-c/parts/issues/617)) ([#632](https://github.com/rig-c/parts/issues/632)) ([591df55](https://github.com/rig-c/parts/commit/591df555ced1d26000f1c086dcb1209df337d0d1))
* **rig:** an influence mesh under `influence.hold_tip: true` gets the lattice's held-fork share smoothing, capped at its declared max, and propose drafts the field and max 8 from the recipe ([#615](https://github.com/rig-c/parts/issues/615)) ([#622](https://github.com/rig-c/parts/issues/622)) ([863fdc7](https://github.com/rig-c/parts/commit/863fdc7d16109c2aef46b882878c034bb39e927d))


### Bug Fixes

* **assemble:** a subset set's limb part counts merged_px and its cap after [#587](https://github.com/rig-c/parts/issues/587)'s exclusion, and the cap records the pixels it cleared as excluded_px ([#603](https://github.com/rig-c/parts/issues/603)) ([#619](https://github.com/rig-c/parts/issues/619)) ([ce247e3](https://github.com/rig-c/parts/commit/ce247e339bb3f9a9cbcf92eb4709703d521ed252))
* **assemble:** the limb-set island rule ignores specks under 1 % of the largest island, and gives a joint just off the art to the one island within its cap's radius ([#608](https://github.com/rig-c/parts/issues/608)) ([#614](https://github.com/rig-c/parts/issues/614)) ([5db9fba](https://github.com/rig-c/parts/commit/5db9fbaa5c9d88c6dd0fe392cf83e0c72ab75232))
* **docs:** AUTHORING and cloth.ts name the influence radius ceiling, +4 cells fails CHECK_TIP_OVER_ROOT on wind's bottomwear, so the window is +2 to +3 ([#599](https://github.com/rig-c/parts/issues/599)) ([#611](https://github.com/rig-c/parts/issues/611)) ([0776d20](https://github.com/rig-c/parts/commit/0776d20f3cebf03450f8c0e1b3c371900e431594))
* **parts:** the parts.json reader holds a set record's cap to the same rule as a base part's cap ([#620](https://github.com/rig-c/parts/issues/620)) ([#623](https://github.com/rig-c/parts/issues/623)) ([4e8a5ef](https://github.com/rig-c/parts/commit/4e8a5ef7f03c3dc6678899c497380f6cc0cf225e))
* **remesh:** remesh --delta expands the input's stops before it poses the bones, as rigc does, and an unresolvable parent is a named refusal ([#613](https://github.com/rig-c/parts/issues/613)) ([#618](https://github.com/rig-c/parts/issues/618)) ([f5ab456](https://github.com/rig-c/parts/commit/f5ab456b5aa7d03a2daa7304a600a0b61339759d))
* **selftest:** the imports from ./src/check.ts are one multi-line statement, one name per line, so parallel PRs stop colliding on one line ([#606](https://github.com/rig-c/parts/issues/606)) ([#610](https://github.com/rig-c/parts/issues/610)) ([c368fb7](https://github.com/rig-c/parts/commit/c368fb793117d443aad54d3dfa7f2f79ecce3889))

## [1.54.0](https://github.com/rig-c/parts/compare/v1.53.0...v1.54.0) (2026-10-21)


### Features

* **assemble:** a one-side limb set cut from a two-leg layer keeps the island its limb's joints fall on, and refuses by name when the joints fall on none or on two ([#588](https://github.com/rig-c/parts/issues/588)) ([#605](https://github.com/rig-c/parts/issues/605)) ([25cc35d](https://github.com/rig-c/parts/commit/25cc35dc64d80974ed87183906c49cee06fe11d9))
* **assemble:** a subset set's limb parts leave out the pixels a base part the set does not replace covers, and the set LINT counts them ([#587](https://github.com/rig-c/parts/issues/587)) ([#602](https://github.com/rig-c/parts/issues/602)) ([ccfc403](https://github.com/rig-c/parts/commit/ccfc40305a2c67fcadc20fcd131a13b88d6ec3ff))

## [1.53.0](https://github.com/rig-c/parts/compare/v1.52.0...v1.53.0) (2026-10-20)


### Features

* **check:** the fold refusal names the bones the worst frame's folded triangles hang on ([#567](https://github.com/rig-c/parts/issues/567)) ([#589](https://github.com/rig-c/parts/issues/589)) ([cd2f0ec](https://github.com/rig-c/parts/commit/cd2f0ecd5962971846f4cbb608377c4b7a8b4651))
* **limbs:** cap_shape "ball" puts the disc on both sides of the joint line, its lower half written only where the lower layer is transparent ([#579](https://github.com/rig-c/parts/issues/579)) ([#597](https://github.com/rig-c/parts/issues/597)) ([5811bd4](https://github.com/rig-c/parts/commit/5811bd466a0877c12935e1e3e7ea01acb61996f4))
* **propose:** propose --cloth names a keyed sibling the recipe leaves alone under its parent whose amplitude now fails CHAIN_LAG, and changes no amplitude ([#572](https://github.com/rig-c/parts/issues/572)) ([#596](https://github.com/rig-c/parts/issues/596)) ([e965e9f](https://github.com/rig-c/parts/commit/e965e9fff07db9475d3eccdef35e56ddce945029))
* **propose:** with --keypoints, a figure of one material drafts its trunk, arms and legs from the one layer that holds their joints ([#577](https://github.com/rig-c/parts/issues/577)) ([#601](https://github.com/rig-c/parts/issues/601)) ([60dc2b7](https://github.com/rig-c/parts/commit/60dc2b755280c1f4ee142e8c15ec005c502a54d2))


### Bug Fixes

* **check:** CHECK_CHAIN_LAG prints the raw phases, says the step is folded modulo half a cycle, and gives the child phases that pass ([#580](https://github.com/rig-c/parts/issues/580)) ([#595](https://github.com/rig-c/parts/issues/595)) ([2111904](https://github.com/rig-c/parts/commit/2111904d52be9cbb23a567beb9d8a7c105438dde))
* **docs:** ANIMATIONS_DO_NOT_FOLD is judged with physics on and off since [#363](https://github.com/rig-c/parts/issues/363) — AUTHORING's stale example and sentence are corrected and held to the printed line ([#568](https://github.com/rig-c/parts/issues/568)) ([#594](https://github.com/rig-c/parts/issues/594)) ([3aec368](https://github.com/rig-c/parts/commit/3aec368783fc3fbde64fa02c9dcdc37a2be2240c))
* **docs:** AUTHORING has a recipe for planted feet on a parts figure, and says which bones a contour bridge's vertices take ([#570](https://github.com/rig-c/parts/issues/570)) ([#592](https://github.com/rig-c/parts/issues/592)) ([98773d6](https://github.com/rig-c/parts/commit/98773d676a1e22b9873dc80214932e600a177887))

## [1.52.0](https://github.com/rig-c/parts/compare/v1.51.0...v1.52.0) (2026-10-20)


### Features

* **assemble:** a cut from a layer a limb already takes is read against the limb's joint lines — past them it builds, inside a segment's band it is refused ASSEMBLE_CUT_CROSSES_LIMB ([#564](https://github.com/rig-c/parts/issues/564)) ([#583](https://github.com/rig-c/parts/issues/583)) ([ac7f2e5](https://github.com/rig-c/parts/commit/ac7f2e502a135e884b4b6ce3dd9ac1d5f6e827bc))
* **cli:** mesh-stats prints each mesh's vertices and triangles and the total before a build, from the rig stage's own meshing ([#566](https://github.com/rig-c/parts/issues/566)) ([#584](https://github.com/rig-c/parts/issues/584)) ([264a8e7](https://github.com/rig-c/parts/commit/264a8e77d8174fd2da656af9618c9424eeb6d495))


### Bug Fixes

* **config:** an animations_from file missing its spec is told the line to write, a missing file names the directory it was resolved against, and AUTHORING shows a looping rigc-motion/1 file ([#569](https://github.com/rig-c/parts/issues/569)) ([#582](https://github.com/rig-c/parts/issues/582)) ([9ea1210](https://github.com/rig-c/parts/commit/9ea121082f4596c13cfb3432ba5807c3de4e8501))
* **docs:** PAINTING names what DWPose does with a faceless figure — no person under the default detector, mirrored sides, hips on the pelvis ([#578](https://github.com/rig-c/parts/issues/578)) ([#585](https://github.com/rig-c/parts/issues/585)) ([bbbb00b](https://github.com/rig-c/parts/commit/bbbb00b6c65bf168f0aadb4fd0d94e505794d2ae))

## [1.51.0](https://github.com/rig-c/parts/compare/v1.50.0...v1.51.0) (2026-10-20)


### Features

* **limbs:** a cut cap short of layer pixels is named by side, filled from the neighbouring segment under either cap shape, and its contour step read at the sweep's ends ([#573](https://github.com/rig-c/parts/issues/573)) ([db7e66b](https://github.com/rig-c/parts/commit/db7e66b907e12644091d5ee7b12896187ad58056))


### Bug Fixes

* **propose:** --write-config --from &lt;previous config&gt; — an entry equal to the previous recipe's draft is the recipe's, not a hand edit ([#571](https://github.com/rig-c/parts/issues/571)) ([#575](https://github.com/rig-c/parts/issues/575)) ([2447004](https://github.com/rig-c/parts/commit/244700405cc490d9f0e9475fc75bf61fdf6d1d99))

## [1.50.0](https://github.com/rig-c/parts/compare/v1.49.2...v1.50.0) (2026-10-20)


### Features

* **build:** the requirements file a build needed is declared in the config and recorded in check.json, so a rebuild finds it ([#556](https://github.com/rig-c/parts/issues/556)) ([#574](https://github.com/rig-c/parts/issues/574)) ([62f70ea](https://github.com/rig-c/parts/commit/62f70eabc1bdb225f7b5c642138e869d1f3cf2a7))

## [1.49.2](https://github.com/rig-c/parts/compare/v1.49.1...v1.49.2) (2026-10-20)


### Bug Fixes

* **ci:** a tag release-please cut whose npm publish did not land can be republished — workflow_dispatch(tag) ([#563](https://github.com/rig-c/parts/issues/563)) ([b502a07](https://github.com/rig-c/parts/commit/b502a07581349cb767f42a57dd225256fa0227ed))
* **rig:** mesh_report names the bones the emitted model binds, in every mode — STABILITY names the cut ([#536](https://github.com/rig-c/parts/issues/536)) ([#562](https://github.com/rig-c/parts/issues/562)) ([89f1e0e](https://github.com/rig-c/parts/commit/89f1e0ee3e350e7b9d734414ed7b4842065e8095))

## [1.49.1](https://github.com/rig-c/parts/compare/v1.49.0...v1.49.1) (2026-10-20)


### Bug Fixes

* **propose:** --write-config splices bones, constraints and tracks entry by entry, keeps hand-added ones, refuses a conflict by name ([#552](https://github.com/rig-c/parts/issues/552)) ([#558](https://github.com/rig-c/parts/issues/558)) ([a279e33](https://github.com/rig-c/parts/commit/a279e33029ebc4e0da7850df9e2bb35f53a50be6))

## [1.49.0](https://github.com/rig-c/parts/compare/v1.48.0...v1.49.0) (2026-10-20)


### Features

* **remesh,retune:** the provenance carries check's final line and every block's status, as check itself reports ([#541](https://github.com/rig-c/parts/issues/541)) ([#551](https://github.com/rig-c/parts/issues/551)) ([7a15084](https://github.com/rig-c/parts/commit/7a1508420366a735b73cb56fa5283593c6e8a52a))


### Bug Fixes

* **requirements:** refuse a contact or aim whose target is the subject's own bone — a vacuous PASS ([#540](https://github.com/rig-c/parts/issues/540)) ([#553](https://github.com/rig-c/parts/issues/553)) ([add4115](https://github.com/rig-c/parts/commit/add4115d13b060b90c410ac8c0ea1484f3813c8a))

## [1.48.0](https://github.com/rig-c/parts/compare/v1.47.0...v1.48.0) (2026-10-20)


### Features

* **check:** --environment takes the readings under a rigc-environment/1 schedule, and names it ([#538](https://github.com/rig-c/parts/issues/538)) ([#549](https://github.com/rig-c/parts/issues/549)) ([facf1f5](https://github.com/rig-c/parts/commit/facf1f53bc31e020a34b01cb6571d5d5e6d48c0d))

## [1.47.0](https://github.com/rig-c/parts/compare/v1.46.0...v1.47.0) (2026-10-20)


### Features

* **propose:** --cloth --write-config writes the drafted trees into the input config's own text, every other byte held ([#537](https://github.com/rig-c/parts/issues/537)) ([#547](https://github.com/rig-c/parts/issues/547)) ([d5f2518](https://github.com/rig-c/parts/commit/d5f2518f0f7dca520bb7115876e0e3d344609cc5))

## [1.46.0](https://github.com/rig-c/parts/compare/v1.45.0...v1.46.0) (2026-10-20)


### Features

* **turn:** a part that rides another part's bone takes its host's depth, and an authored depth that leaves its host is refused ([#535](https://github.com/rig-c/parts/issues/535)) ([#545](https://github.com/rig-c/parts/issues/545)) ([ae446a2](https://github.com/rig-c/parts/commit/ae446a2759090d65db57ceb07515e61f17f8b0d1))

## [1.45.0](https://github.com/rig-c/parts/compare/v1.44.0...v1.45.0) (2026-10-20)


### Features

* **alternates:** cut a skeleton set at its own joint positions, registered on the base torso, and record drawnLength ([#539](https://github.com/rig-c/parts/issues/539)) ([#542](https://github.com/rig-c/parts/issues/542)) ([2a4ad44](https://github.com/rig-c/parts/commit/2a4ad443e60ed3ab87a26e5c750761752778ce98))

## [1.44.0](https://github.com/rig-c/parts/compare/v1.43.0...v1.44.0) (2026-10-20)


### Features

* **retune:** splice constraints and the idle onto a gated rig, every other byte held ([#530](https://github.com/rig-c/parts/issues/530)) ([e24fa64](https://github.com/rig-c/parts/commit/e24fa648bfd139b38f16730d8214b5d6c0ec3d0e)), closes [#527](https://github.com/rig-c/parts/issues/527)

## [1.43.0](https://github.com/rig-c/parts/compare/v1.42.0...v1.43.0) (2026-10-20)


### Features

* **remesh:** --delta replays rig-c/review's mesh edit over one part's mesh ([#528](https://github.com/rig-c/parts/issues/528)) ([773cea8](https://github.com/rig-c/parts/commit/773cea8036018b2428fe9a76e878ad4802c4a65e)), closes [#526](https://github.com/rig-c/parts/issues/526)

## [1.42.0](https://github.com/rig-c/parts/compare/v1.41.1...v1.42.0) (2026-10-19)


### Features

* **propose:** draft cloth parts in the influence mode when a recipe opts in, at farthest + 3 cells ([#522](https://github.com/rig-c/parts/issues/522)) ([93c7d3d](https://github.com/rig-c/parts/commit/93c7d3dc33db251c13513118599775adbfee485a)), closes [#518](https://github.com/rig-c/parts/issues/518)


### Bug Fixes

* **notice:** state the Spine terms' trigger as rig-c's NOTICE does — the integration of a Spine Runtime ([#524](https://github.com/rig-c/parts/issues/524)) ([d1e1c49](https://github.com/rig-c/parts/commit/d1e1c49943cd0ec5558d8b8f9f91614a1537be80)), closes [#520](https://github.com/rig-c/parts/issues/520)
* **selftest:** refuse a case prefix two suites print, and give the five shared prefixes one suite each ([#523](https://github.com/rig-c/parts/issues/523)) ([786bacd](https://github.com/rig-c/parts/commit/786bacd405a4ef9c0bfd0767276e6c73114a2883))

## [1.41.1](https://github.com/rig-c/parts/compare/v1.41.0...v1.41.1) (2026-10-19)


### Bug Fixes

* **propose:** draft the legs without the ankle cut when an ankle lies off its leg's art, and say how far ([#519](https://github.com/rig-c/parts/issues/519)) ([ecf9a55](https://github.com/rig-c/parts/commit/ecf9a55be0460ad22eb6d92de9d9fdd8c41e19ed)), closes [#517](https://github.com/rig-c/parts/issues/517)

## [1.41.0](https://github.com/rig-c/parts/compare/v1.40.0...v1.41.0) (2026-10-19)


### Features

* **rig:** an influence mesh mode for cloth and hair, weighted by rig-c's own segments rule ([#514](https://github.com/rig-c/parts/issues/514)) ([c46083e](https://github.com/rig-c/parts/commit/c46083e47afcf2efcdb36f0025e35f50e0e84418))

## [1.40.0](https://github.com/rig-c/parts/compare/v1.39.0...v1.40.0) (2026-10-19)


### Features

* **remesh:** re-fit one part of a gated rig under a requested entry into a new revision ([#512](https://github.com/rig-c/parts/issues/512)) ([d35b958](https://github.com/rig-c/parts/commit/d35b958d95af4da6c7326e33fa8f9f07cfa6449a))


### Bug Fixes

* **docs:** write the command-post protocol into CLAUDE.md and delegate the cut ([#510](https://github.com/rig-c/parts/issues/510)) ([8401f78](https://github.com/rig-c/parts/commit/8401f78fc16fde652c4bc7ab4e6c2d8036456332)), closes [#509](https://github.com/rig-c/parts/issues/509)

## [1.39.0](https://github.com/rig-c/parts/compare/v1.38.0...v1.39.0) (2026-10-19)


### Features

* **check:** CLOTH_SETTLES — a physics chain that comes to rest on the idle is a warning, never a bar ([#501](https://github.com/rig-c/parts/issues/501)) ([#507](https://github.com/rig-c/parts/issues/507)) ([b5fae5b](https://github.com/rig-c/parts/commit/b5fae5b67e290174a29bf27fa6bb22f3bf8713db))


### Bug Fixes

* **cloth:** a standing cloth is the consumer's to drive; the idle keeps no hip key ([#502](https://github.com/rig-c/parts/issues/502)) ([#508](https://github.com/rig-c/parts/issues/508)) ([a2dac91](https://github.com/rig-c/parts/commit/a2dac912b8fd55881658de1abc1fa3e85faebae5))
* **selftest:** refuse unknown flags by name and run --only partial runs ([#505](https://github.com/rig-c/parts/issues/505)) ([7b6b9b2](https://github.com/rig-c/parts/commit/7b6b9b2af23c8d752b39c8c838c94f3bc41d4d0b)), closes [#500](https://github.com/rig-c/parts/issues/500)

## [1.38.0](https://github.com/rig-c/parts/compare/v1.37.0...v1.38.0) (2026-10-19)


### Features

* **check:** SEAM_OVER_MOTION — every declared neighbour pair read in every animation, a warning and never a bar ([#503](https://github.com/rig-c/parts/issues/503)) ([78bb633](https://github.com/rig-c/parts/commit/78bb633f6840b38feebb1086964863eb80117e5a))

## [1.37.0](https://github.com/rig-c/parts/compare/v1.36.0...v1.37.0) (2026-10-18)


### Features

* **assemble:** refuse or underfill hollow See-through head-run face ([#492](https://github.com/rig-c/parts/issues/492)) ([#499](https://github.com/rig-c/parts/issues/499)) ([ee16046](https://github.com/rig-c/parts/commit/ee160464dc480ab3c1613b8d69807c50839cc053))
* **assemble:** split or refuse merged See-through arm layers ([#490](https://github.com/rig-c/parts/issues/490)) ([#496](https://github.com/rig-c/parts/issues/496)) ([5e0789a](https://github.com/rig-c/parts/commit/5e0789a04dcb63612d358539526cdcc31ca49df4))
* **propose:** place hanging arm elbow cut from limb chain when wrist lands off layer ([#491](https://github.com/rig-c/parts/issues/491)) ([#498](https://github.com/rig-c/parts/issues/498)) ([091f630](https://github.com/rig-c/parts/commit/091f6301b3da195898f5478f994949a4e5f7cd33))

## [1.36.0](https://github.com/rig-c/parts/compare/v1.35.0...v1.36.0) (2026-10-18)


### Features

* **sets:** support gesture subset sets over limb chains ([#476](https://github.com/rig-c/parts/issues/476)) ([5b52552](https://github.com/rig-c/parts/commit/5b525528eda28d5380d9880f3a980caac2024a0a))

## [1.35.0](https://github.com/rig-c/parts/compare/v1.34.0...v1.35.0) (2026-10-18)


### Features

* **contour:** derive bust regions from apex_r, apex_l and cleavage ([#475](https://github.com/rig-c/parts/issues/475)) ([#486](https://github.com/rig-c/parts/issues/486)) ([9e86034](https://github.com/rig-c/parts/commit/9e86034fcad9092fbce2ffd28912e146e253d702))
* **sets:** expand attachment track set keys and scope subset fold checks ([#473](https://github.com/rig-c/parts/issues/473)) ([#488](https://github.com/rig-c/parts/issues/488)) ([78bdc00](https://github.com/rig-c/parts/commit/78bdc00b54875d6eaf3b6c2ccea3ef1ce975adf3))

## [1.34.0](https://github.com/rig-c/parts/compare/v1.33.0...v1.34.0) (2026-10-17)


### Features

* **turn:** counter-translate back of head about head-only pivot ([#478](https://github.com/rig-c/parts/issues/478)) ([#483](https://github.com/rig-c/parts/issues/483)) ([dee31cc](https://github.com/rig-c/parts/commit/dee31ccd61d97f543212a7a6ff6bbf376fa67ecb))
* **turn:** project yaw face surface on a cylinder with fixed outline ([#479](https://github.com/rig-c/parts/issues/479)) ([#485](https://github.com/rig-c/parts/issues/485)) ([b8a5f6f](https://github.com/rig-c/parts/commit/b8a5f6fdb98973033dfde4315bd4ceb97082232a))

## [1.33.0](https://github.com/rig-c/parts/compare/v1.32.0...v1.33.0) (2026-10-17)


### Features

* **turn:** rate single-plate face turn to ±15° yaw / ±12° pitch ([#472](https://github.com/rig-c/parts/issues/472)) ([#481](https://github.com/rig-c/parts/issues/481)) ([790e5dc](https://github.com/rig-c/parts/commit/790e5dc849f8d5168891700a8817794619bcfea4))
* **turn:** sample face surface deform field for features with foreshortening ([#468](https://github.com/rig-c/parts/issues/468)) ([#470](https://github.com/rig-c/parts/issues/470)) ([27370c1](https://github.com/rig-c/parts/commit/27370c10cf841cb8eae849faec83c77097e4ea60))


### Bug Fixes

* **propose:** draft two chains for separated short side twintails ([#466](https://github.com/rig-c/parts/issues/466)) ([#480](https://github.com/rig-c/parts/issues/480)) ([b3bac18](https://github.com/rig-c/parts/commit/b3bac1876023fba0cf614aedd9560cc983427d0e))
* **turn:** honour authored ear depth in turn or refuse out-of-range by name ([#477](https://github.com/rig-c/parts/issues/477)) ([#482](https://github.com/rig-c/parts/issues/482)) ([c313cee](https://github.com/rig-c/parts/commit/c313ceec08ca31b767ec7b617e1a1bf54e236406))

## [1.32.0](https://github.com/rig-c/parts/compare/v1.31.0...v1.32.0) (2026-10-17)


### Features

* **alternates:** compensate drawn bone angles on posed alternate sets ([#467](https://github.com/rig-c/parts/issues/467)) ([3d60f8f](https://github.com/rig-c/parts/commit/3d60f8f6d87014108ccf0e95ba047c5f0c6898f0)), closes [#465](https://github.com/rig-c/parts/issues/465)

## [1.31.0](https://github.com/rig-c/parts/compare/v1.30.0...v1.31.0) (2026-10-17)


### Features

* **assemble:** emit alternate paintings as attachment sets on the same bones ([#462](https://github.com/rig-c/parts/issues/462)) ([af697f3](https://github.com/rig-c/parts/commit/af697f3e57b96ab0200492e6f8d6a9354faec4b3)), closes [#454](https://github.com/rig-c/parts/issues/454)


### Bug Fixes

* **cloth:** place back-hair trees inside each visible mass by root-row width ([#464](https://github.com/rig-c/parts/issues/464)) ([89d55fd](https://github.com/rig-c/parts/commit/89d55fd0f56768eb3880fad1b640ba5b8e408e51)), closes [#461](https://github.com/rig-c/parts/issues/461)

## [1.30.0](https://github.com/rig-c/parts/compare/v1.29.0...v1.30.0) (2026-10-16)


### Features

* **propose:** lint stop against rising limb placing touch above first link ([#457](https://github.com/rig-c/parts/issues/457)) ([4525539](https://github.com/rig-c/parts/commit/4525539765e50de4745642bf1053e73697549e9c)), closes [#447](https://github.com/rig-c/parts/issues/447)


### Bug Fixes

* **propose:** resolve wrist on crossed opposite-side handwear parts to own side ([#458](https://github.com/rig-c/parts/issues/458)) ([#460](https://github.com/rig-c/parts/issues/460)) ([1cf29eb](https://github.com/rig-c/parts/commit/1cf29eb922bd536e30719c866dc607e017a013cb))

## [1.29.0](https://github.com/rig-c/parts/compare/v1.28.0...v1.29.0) (2026-10-16)


### Features

* **assemble:** separate overlapping arms via seethrough.arm_split ([#439](https://github.com/rig-c/parts/issues/439)) ([#453](https://github.com/rig-c/parts/issues/453)) ([fbe3027](https://github.com/rig-c/parts/commit/fbe3027274ae23a70039757d0935b43a75266803))
* **limbs:** add declared per-limb split for crossed legs in one layer ([#446](https://github.com/rig-c/parts/issues/446)) ([#456](https://github.com/rig-c/parts/issues/456)) ([5a705f1](https://github.com/rig-c/parts/commit/5a705f1432769391861c318be422ebfb44c16f73))
* **propose:** reconstruct pre-limb parts in one run ([#440](https://github.com/rig-c/parts/issues/440)) ([#455](https://github.com/rig-c/parts/issues/455)) ([eb05790](https://github.com/rig-c/parts/commit/eb05790f4f4537dee3a0305830b02cf545d28be8))


### Bug Fixes

* **cloth:** derive back-hair tree count from visible hanging masses ([322484a](https://github.com/rig-c/parts/commit/322484a8af85672832493bb6aed1506fe7e52ba5))
* **cloth:** derive back-hair tree count from visible hanging masses ([1e87ff1](https://github.com/rig-c/parts/commit/1e87ff1307b7606e99cf0c177d0ff6718bf35bf8)), closes [#445](https://github.com/rig-c/parts/issues/445)
* **cloth:** place bottomwear tree tips on each column's own cloth alpha ([#438](https://github.com/rig-c/parts/issues/438)) ([#452](https://github.com/rig-c/parts/issues/452)) ([48542f1](https://github.com/rig-c/parts/commit/48542f10d30a63786e5d33895085c7282e4c87aa))

## [1.28.0](https://github.com/rig-c/parts/compare/v1.27.0...v1.28.0) (2026-10-16)


### Features

* **turn:** deform face and hair meshes along turn and tilt sliders ([#436](https://github.com/rig-c/parts/issues/436)) ([#443](https://github.com/rig-c/parts/issues/443)) ([5c81e79](https://github.com/rig-c/parts/commit/5c81e79d37d35682c41f8122c8f62c08cadd4f87))

## [1.27.0](https://github.com/rig-c/parts/compare/v1.26.0...v1.27.0) (2026-10-16)


### Features

* **cloth:** allow a declared tree to span a list of parts ([#437](https://github.com/rig-c/parts/issues/437)) ([#441](https://github.com/rig-c/parts/issues/441)) ([d9343cb](https://github.com/rig-c/parts/commit/d9343cb19f2e06f33a2887456a3ad3025b10de75))


### Bug Fixes

* **assemble:** keep counts consistent on feathered joints of crossed limbs ([#448](https://github.com/rig-c/parts/issues/448)) ([956a8a6](https://github.com/rig-c/parts/commit/956a8a62bb73f4803fa83fcd30a9d0cebf589ac4)), closes [#444](https://github.com/rig-c/parts/issues/444)

## [1.26.0](https://github.com/rig-c/parts/compare/v1.25.0...v1.26.0) (2026-10-15)


### Features

* **check:** judge folds with physics on and report physics on/off side by side ([#425](https://github.com/rig-c/parts/issues/425)) ([8d92181](https://github.com/rig-c/parts/commit/8d921814294a2d8c9e71e07e28cdb4a50e4dcf9f)), closes [#363](https://github.com/rig-c/parts/issues/363)
* **cloth:** accept explicitly named topwear skirt cuts ([#430](https://github.com/rig-c/parts/issues/430)) ([bfdc4c4](https://github.com/rig-c/parts/commit/bfdc4c443625b6eb4e214ccac93c7fd435670fe4)), closes [#412](https://github.com/rig-c/parts/issues/412)
* **config:** refuse assemble.rig_scale mismatch against proposed_rig_scale ([#354](https://github.com/rig-c/parts/issues/354)) ([#427](https://github.com/rig-c/parts/issues/427)) ([7e16e68](https://github.com/rig-c/parts/commit/7e16e6806b5c3efd91a7ef1db690a69f20b3e423))
* **rig:** allow explicit inheritance on named chain links ([#429](https://github.com/rig-c/parts/issues/429)) ([63c776a](https://github.com/rig-c/parts/commit/63c776aa51af00a3cfd85dd7c1d359691279d5c3)), closes [#369](https://github.com/rig-c/parts/issues/369)


### Bug Fixes

* **check,headbox,assemble:** name root carrier, back-hair box growth, behind drift and hole causes ([#351](https://github.com/rig-c/parts/issues/351)) ([#435](https://github.com/rig-c/parts/issues/435)) ([f1c735f](https://github.com/rig-c/parts/commit/f1c735f9d4f73b1ada273dd07f38f686eb48182f))
* **cloth,rig:** hold forked trees under strong wind and smooth fork shares ([#392](https://github.com/rig-c/parts/issues/392)) ([#432](https://github.com/rig-c/parts/issues/432)) ([a5ce8d6](https://github.com/rig-c/parts/commit/a5ce8d6b8d9be74a8fb6be67694ce37904c8c133))
* **propose:** derive back-hair tree count from root-row tail width and refuse off-art chains ([#390](https://github.com/rig-c/parts/issues/390)) ([#433](https://github.com/rig-c/parts/issues/433)) ([a75f82c](https://github.com/rig-c/parts/commit/a75f82cc2280d3ff89e0e52f8dae8a3f74ed951c))
* **scene:** carry and scale member stops in compose ([#431](https://github.com/rig-c/parts/issues/431)) ([#434](https://github.com/rig-c/parts/issues/434)) ([bc5b737](https://github.com/rig-c/parts/commit/bc5b73733bdf73c2cc9f45fbbac9f14eea51981a))

## [1.25.0](https://github.com/rig-c/parts/compare/v1.24.0...v1.25.0) (2026-10-15)


### Features

* **config:** declare rig-c leg stops and pass through to rig.json ([#404](https://github.com/rig-c/parts/issues/404)) ([#421](https://github.com/rig-c/parts/issues/421)) ([3f16c50](https://github.com/rig-c/parts/commit/3f16c50c0f5ac3d12a29f41e1d21088ed40bc540))
* **limbs:** keep overlapping hands whole on front forearm ([#400](https://github.com/rig-c/parts/issues/400)) ([#423](https://github.com/rig-c/parts/issues/423)) ([cf1346b](https://github.com/rig-c/parts/commit/cf1346bf585c590822c7a0f272fe0e459e34a633))
* **propose:** a bottomwear piece lying on a declared dress rides the dress's trees, so one skirt carries one set ([#419](https://github.com/rig-c/parts/issues/419)) ([6355ce5](https://github.com/rig-c/parts/commit/6355ce52c9d126ce179fd5fea08e8a9f80bd0e79)), closes [#416](https://github.com/rig-c/parts/issues/416)


### Bug Fixes

* **cloth:** name branched tip squeeze and hold tips via split.hold_tip ([#403](https://github.com/rig-c/parts/issues/403)) ([#422](https://github.com/rig-c/parts/issues/422)) ([0e246bd](https://github.com/rig-c/parts/commit/0e246bdf508111caaf297db255bbf18dd99a34c7))
* **rig:** keep skirt tree weights off declared dress bodice above hip ([#417](https://github.com/rig-c/parts/issues/417)) ([#424](https://github.com/rig-c/parts/issues/424)) ([e753fea](https://github.com/rig-c/parts/commit/e753fea120ebb8a27472caaf7220062a2d629418))

## [1.24.0](https://github.com/rig-c/parts/compare/v1.23.0...v1.24.0) (2026-10-14)


### Features

* **propose:** a ribbon wrapped round a tail the cloth recipe drafts rides the tail's links ([#414](https://github.com/rig-c/parts/issues/414)) ([fbd638d](https://github.com/rig-c/parts/commit/fbd638d23d8644444f853d6c2c911b819cc849f9)), closes [#391](https://github.com/rig-c/parts/issues/391)


### Bug Fixes

* **check:** BREATH_VISIBLE reads the breath alone, so keyed cloth swing cannot pass it ([#418](https://github.com/rig-c/parts/issues/418)) ([babd373](https://github.com/rig-c/parts/commit/babd373085cee541cd3e13d26ca06c04e6295c04)), closes [#411](https://github.com/rig-c/parts/issues/411)

## [1.23.0](https://github.com/rig-c/parts/compare/v1.22.0...v1.23.0) (2026-10-14)


### Features

* **propose:** name a topwear shaped like a skirt, and let `cloth.bottomwear.part` hand it the skirt's trees ([#410](https://github.com/rig-c/parts/issues/410)) ([330cf52](https://github.com/rig-c/parts/commit/330cf52f06ef1e849901a069a2847dc99ad0f639)), closes [#402](https://github.com/rig-c/parts/issues/402)


### Bug Fixes

* **check:** name the renderer profile rig-play where the tree speaks in its own words ([#405](https://github.com/rig-c/parts/issues/405)) ([2d01057](https://github.com/rig-c/parts/commit/2d01057639c9c3d41f48d8f0e86931d362974c1a)), closes [#380](https://github.com/rig-c/parts/issues/380)
* **docs:** say that every example's expected/rig.json is the flat form, held by tree rule TY19 ([#408](https://github.com/rig-c/parts/issues/408)) ([fd60e34](https://github.com/rig-c/parts/commit/fd60e349c6333ba661ff7a1d23cb4ce44a2ee172)), closes [#397](https://github.com/rig-c/parts/issues/397)

## [1.22.0](https://github.com/rig-c/parts/compare/v1.21.0...v1.22.0) (2026-10-14)


### Features

* **assemble:** `cut_band` places a limb joint's cut on the line in the band that crosses the fewest stroke pixels ([#398](https://github.com/rig-c/parts/issues/398)) ([e20f56f](https://github.com/rig-c/parts/commit/e20f56fa0f7c71b62f2144da8f14c77b226c542b)), closes [#360](https://github.com/rig-c/parts/issues/360)

## [1.21.0](https://github.com/rig-c/parts/compare/v1.20.0...v1.21.0) (2026-10-14)


### Features

* **assemble:** `cuts[].under_fill: "colour"` fills a cut's under with its colour at the alpha the cut removed ([#394](https://github.com/rig-c/parts/issues/394)) ([c5b4937](https://github.com/rig-c/parts/commit/c5b4937c56c2c651dc24b797103c2a678012a854)), closes [#360](https://github.com/rig-c/parts/issues/360)
* **assemble:** edge "feather" and cap_shape "disc" on a limb joint, the disc held to no uncovered pixel by SEAM_OVER_RANGE ([#389](https://github.com/rig-c/parts/issues/389)) ([e4c16e7](https://github.com/rig-c/parts/commit/e4c16e7284c4c7e8e62b85210e610ac95671d9f0)), closes [#360](https://github.com/rig-c/parts/issues/360)
* **check:** read the seam with each limb joint bent to its declared range (SEAM_OVER_RANGE) ([#387](https://github.com/rig-c/parts/issues/387)) ([5b5b204](https://github.com/rig-c/parts/commit/5b5b2047cc6633e5fa9381287e78c577342cd67b)), closes [#360](https://github.com/rig-c/parts/issues/360)
* **examples:** add `wind`, the first example built with the cloth recipe and limbs, at parts-examples ba99e40 ([#393](https://github.com/rig-c/parts/issues/393)) ([d3e7454](https://github.com/rig-c/parts/commit/d3e74542d0c67e4ab123575d34a9911ad431561d))

## [1.20.0](https://github.com/rig-c/parts/compare/v1.19.0...v1.20.0) (2026-10-13)


### Features

* **propose:** draft cloth and hair as physics trees that answer the environment, behind `--cloth` (opt-in) ([#384](https://github.com/rig-c/parts/issues/384)) ([435b906](https://github.com/rig-c/parts/commit/435b90690439a132672735058cba0ecee7d6ae00)), closes [#364](https://github.com/rig-c/parts/issues/364)


### Bug Fixes

* **deps:** rig-c ^2.53.0, and pass --profile rig-play, the name rigc keeps ([#379](https://github.com/rig-c/parts/issues/379)) ([ded4011](https://github.com/rig-c/parts/commit/ded40112780b293935992ede9d2e041895349214))
* **deps:** rig-c ^2.54.0, whose A23 refuses a physics step that cannot settle ([#386](https://github.com/rig-c/parts/issues/386)) ([e2859cf](https://github.com/rig-c/parts/commit/e2859cfb0bb983e0e89db30ba690869c05c897fb))
* **readme:** name every proposal section in the loop's paste step, held to the proposal's type and run with keypoints ([#383](https://github.com/rig-c/parts/issues/383)) ([7a80326](https://github.com/rig-c/parts/commit/7a80326ffefc2d126e586f57bb33a2cf9f31d3a8)), closes [#375](https://github.com/rig-c/parts/issues/375)

## [1.19.0](https://github.com/rig-c/parts/compare/v1.18.0...v1.19.0) (2026-10-13)


### Features

* **painting:** read an occluded hip, and replace the recipe with one measured painting that passes ([#374](https://github.com/rig-c/parts/issues/374)) ([c521170](https://github.com/rig-c/parts/commit/c521170cb641821d60bfb671b57bcf1ad89499d3)), closes [#372](https://github.com/rig-c/parts/issues/372)

## [1.18.0](https://github.com/rig-c/parts/compare/v1.17.0...v1.18.0) (2026-10-13)


### Features

* **assemble:** accept a non-square single-run file by padding it to the resolution square, and record the pad ([#373](https://github.com/rig-c/parts/issues/373)) ([a0046e7](https://github.com/rig-c/parts/commit/a0046e7042adbf225f6bd985faf7be64f3e47539)), closes [#366](https://github.com/rig-c/parts/issues/366)
* **layers:** export a PSD as the wrapper form, build from one run, and read an artist's hidden art as caps ([#365](https://github.com/rig-c/parts/issues/365)) ([13bc120](https://github.com/rig-c/parts/commit/13bc120a20867114c1fdf606b40e34757843cc8c)), closes [#359](https://github.com/rig-c/parts/issues/359)
* **painting:** say what makes a painting riggable, and check it from the keypoints before See-through ([#371](https://github.com/rig-c/parts/issues/371)) ([af008fe](https://github.com/rig-c/parts/commit/af008fee7570bc183b7619da82da76fb932f915f)), closes [#350](https://github.com/rig-c/parts/issues/350)


### Bug Fixes

* **examples:** hold every fetched input to its blob id at the pin, and replace or refuse a stale one by name ([#370](https://github.com/rig-c/parts/issues/370)) ([f96958c](https://github.com/rig-c/parts/commit/f96958c33fd8914c5c41aae062a857928c65d3c6)), closes [#367](https://github.com/rig-c/parts/issues/367)

## [1.17.0](https://github.com/rig-c/parts/compare/v1.16.0...v1.17.0) (2026-10-13)


### Features

* **assemble:** cut a declared limb at its joints into rigid parts, each lower part carrying a cap ([#362](https://github.com/rig-c/parts/issues/362)) ([5b6ce94](https://github.com/rig-c/parts/commit/5b6ce94a03c99e858e69f6e82a9460db6d2cecf9)), closes [#349](https://github.com/rig-c/parts/issues/349)
* **check:** STRESS_OFF_CHAIN turns each sleeve's chain far and refuses a part weighted off it; propose drafts no chest stub on a sleeve ([#358](https://github.com/rig-c/parts/issues/358)) ([6122be7](https://github.com/rig-c/parts/commit/6122be7bb1590435cb9cba07517f27d9bcd86513)), closes [#347](https://github.com/rig-c/parts/issues/347)
* **config:** expose a bone's inherit mode, and hold the feet level while the leg is posed ([#357](https://github.com/rig-c/parts/issues/357)) ([6bbee3a](https://github.com/rig-c/parts/commit/6bbee3abc58d60f85f6c7220b5976a36b7b26605)), closes [#348](https://github.com/rig-c/parts/issues/348)


### Bug Fixes

* **docs:** say what rig_scale trades, inline demo's wave and where a drafted sleeve bends, and give the idle's strand lag and the topwear arm limit ([#353](https://github.com/rig-c/parts/issues/353)) ([eebfbbf](https://github.com/rig-c/parts/commit/eebfbbf2cf60dd90a58bf18f2a0b8b78ee73acbb)), closes [#345](https://github.com/rig-c/parts/issues/345)

## [1.16.0](https://github.com/rig-c/parts/compare/v1.15.0...v1.16.0) (2026-10-13)


### Features

* **cli:** rig-parts guide prints the row a failure line names, and every FAIL line ends with the command ([#346](https://github.com/rig-c/parts/issues/346)) ([db821b9](https://github.com/rig-c/parts/commit/db821b9afaaa165b14b38ab519efc86dec06757d))


### Bug Fixes

* **docs:** a stretched edge whose ends disagree on a small share at the 0.03 cut — the failure map names the continuous floor, then heat, and says the exponent only moves the figure ([#342](https://github.com/rig-c/parts/issues/342)) ([2e45bf4](https://github.com/rig-c/parts/commit/2e45bf4541cabd812db9692d6c50330455c6f8ac)), closes [#115](https://github.com/rig-c/parts/issues/115)

## [1.15.0](https://github.com/rig-c/parts/compare/v1.14.0...v1.15.0) (2026-10-12)


### Features

* **check:** the fold bar reads the idle — ANIMATIONS_DO_NOT_FOLD over every animation, may_fold takes "idle" ([#338](https://github.com/rig-c/parts/issues/338)) ([a9009c1](https://github.com/rig-c/parts/commit/a9009c1de6809a728b85cec4cfbb3e024e37eeb7)), closes [#333](https://github.com/rig-c/parts/issues/333)


### Bug Fixes

* **mesh-draft:** dust first, then leave out and name faint islands, then bridge every visible one whatever it costs ([#340](https://github.com/rig-c/parts/issues/340)) ([0dc97ad](https://github.com/rig-c/parts/commit/0dc97ad8ae623f50cac80d16a222e0ea22bdc3ba))
* **selftest:** pin the suites' rigc to the package's own, and name the rigc a failed call ran ([#341](https://github.com/rig-c/parts/issues/341)) ([750f118](https://github.com/rig-c/parts/commit/750f118430f65b023fb2b2770f63f13399753eb9)), closes [#337](https://github.com/rig-c/parts/issues/337)

## [1.14.0](https://github.com/rig-c/parts/compare/v1.13.1...v1.14.0) (2026-10-12)


### Features

* **check:** read every animation beside the idle for folds with rigc render --folds — a bar on the keys, with may_fold exceptions ([#332](https://github.com/rig-c/parts/issues/332)) ([e7aee13](https://github.com/rig-c/parts/commit/e7aee13389787e0e6f241031baae7ed2e7bfcd58)), closes [#320](https://github.com/rig-c/parts/issues/320)
* **mesh-draft:** draft a part whose islands ride one bone as the islands joined by bridges ([#335](https://github.com/rig-c/parts/issues/335)) ([f32d002](https://github.com/rig-c/parts/commit/f32d002d1f3691ec7027e040af63c5548ad60f19)), closes [#326](https://github.com/rig-c/parts/issues/326)


### Bug Fixes

* **build:** the loop's jump line names its figures, its cause and `--lead-in`; check's loop line says its physics was left out ([#328](https://github.com/rig-c/parts/issues/328)) ([86a76ce](https://github.com/rig-c/parts/commit/86a76ce74305b32c648b0650e4021d369c3a36dd)), closes [#325](https://github.com/rig-c/parts/issues/325)
* **check:** a stretch requirement's line names the worst edge's bones and chains, as CHECK_TEXTURE_STRETCH does ([#331](https://github.com/rig-c/parts/issues/331)) ([b1269ae](https://github.com/rig-c/parts/commit/b1269ae109d7c7b27d6b3c09f57b2e14107f677a)), closes [#321](https://github.com/rig-c/parts/issues/321)
* **check:** BREATH_VISIBLE reads the torso without footwear and the feet without topwear, and says 1 of 2 halves measured ([#334](https://github.com/rig-c/parts/issues/334)) ([89ae116](https://github.com/rig-c/parts/commit/89ae116c76e1e8c08d9b1ab2c5161ebbf2ea3c7c))
* **check:** rises reads the chain's last link, the end the tip half is the art of — a folded arm declared rises is accepted ([#330](https://github.com/rig-c/parts/issues/330)) ([5c85b33](https://github.com/rig-c/parts/commit/5c85b332ecbd236181bd0d78dec0706ce9140c5a)), closes [#322](https://github.com/rig-c/parts/issues/322)

## [1.13.1](https://github.com/rig-c/parts/compare/v1.13.0...v1.13.1) (2026-10-12)


### Bug Fixes

* **docs:** say which way a rotate key turns a bone — counter-clockwise, y up, as rig-c defines it; translatey raises ([#318](https://github.com/rig-c/parts/issues/318)) ([f2c3786](https://github.com/rig-c/parts/commit/f2c3786270e98d9fefaca302d22c9e7650a50773)), closes [#317](https://github.com/rig-c/parts/issues/317)

## [1.13.0](https://github.com/rig-c/parts/compare/v1.12.0...v1.13.0) (2026-10-12)


### Features

* **mesh-draft:** name every auto or contour entry as not compared, and say in AUTHORING which mode comes out smaller ([#313](https://github.com/rig-c/parts/issues/313)) ([578c5a3](https://github.com/rig-c/parts/commit/578c5a39ffa538a0d0008fcaf2576c59873dfd35)), closes [#307](https://github.com/rig-c/parts/issues/307)
* **propose:** name two chains that squeeze one lattice, and the bones a stretched edge hangs on ([#316](https://github.com/rig-c/parts/issues/316)) ([219721d](https://github.com/rig-c/parts/commit/219721da292c1ee07e45a3fccf10a4f0115be4f5)), closes [#314](https://github.com/rig-c/parts/issues/314)

## [1.12.0](https://github.com/rig-c/parts/compare/v1.11.0...v1.12.0) (2026-10-12)


### Features

* **rig:** a lattice declares `stray`, and heat's two refusals name a remedy the author can take ([#304](https://github.com/rig-c/parts/issues/304)) ([6080178](https://github.com/rig-c/parts/commit/6080178d86e09d8fa418ca656d0f1c2080536a9b))


### Bug Fixes

* **assemble:** --propose-plan names every layer no row takes, with why; nose says what a nose part buys ([#309](https://github.com/rig-c/parts/issues/309)) ([0e13e71](https://github.com/rig-c/parts/commit/0e13e71b70cacec1cf143c8ba936f98741473c03)), closes [#308](https://github.com/rig-c/parts/issues/308)
* **deps:** rig-c ^2.47.1 — build bytes unchanged; the render's physics clock (2.45.2) moves check's idle readings, the lead-in loop and the clip figures, re-measured ([#310](https://github.com/rig-c/parts/issues/310)) ([2be19d1](https://github.com/rig-c/parts/commit/2be19d159da0dd7b0307d3e5c3169e5ac9e05685)), closes [#305](https://github.com/rig-c/parts/issues/305)

## [1.11.0](https://github.com/rig-c/parts/compare/v1.10.0...v1.11.0) (2026-10-12)


### Features

* **rig:** the weight cut is the author's per mesh — meshes.&lt;part&gt;.influences declares the cap (a whole number, or null for none) and the floor's form (cut or continuous) in the lattice and contour modes ([#284](https://github.com/rig-c/parts/issues/284)) ([#301](https://github.com/rig-c/parts/issues/301)) ([0ebd884](https://github.com/rig-c/parts/commit/0ebd8843f16493623815f1d06e823348bb91ff10))

## [1.10.0](https://github.com/rig-c/parts/compare/v1.9.1...v1.10.0) (2026-10-12)


### Features

* **assemble:** a scene painting — read the recomposite inside the figure, write its mask, and leave the frame's border out of the seam ([#291](https://github.com/rig-c/parts/issues/291)) ([76aec5a](https://github.com/rig-c/parts/commit/76aec5ae0d2f44be95446f86472c8cae237e8557)), closes [#242](https://github.com/rig-c/parts/issues/242)
* **build:** forward check's --seam-pairs and --keep-stills, and refuse --rig and --parts by name ([#298](https://github.com/rig-c/parts/issues/298)) ([ce5b6ad](https://github.com/rig-c/parts/commit/ce5b6ad7f1f65a0e8431ee54eab268d80be30687)), closes [#257](https://github.com/rig-c/parts/issues/257)
* **check:** a scene declares a swinging part's tip at rest — rests, the opposite relation on TIP_OVER_ROOT and CHAIN_LAG ([#296](https://github.com/rig-c/parts/issues/296)) ([81815e1](https://github.com/rig-c/parts/commit/81815e1c0bfce9e8bc836744d6d3a7bfb672a18b)), closes [#245](https://github.com/rig-c/parts/issues/245)
* **layers:** an author-made layer is named author:&lt;label&gt; and carries no role ([#300](https://github.com/rig-c/parts/issues/300)) ([b5dc9ec](https://github.com/rig-c/parts/commit/b5dc9ecbfc5b752f86a58922f69891c5bcc1c06f)), closes [#256](https://github.com/rig-c/parts/issues/256)
* **mesh-draft:** draft a traced outline around a coarse grid per lattice part, kept only where it holds against that part's lattice through rig-c ([#265](https://github.com/rig-c/parts/issues/265)) ([#295](https://github.com/rig-c/parts/issues/295)) ([82d2d5b](https://github.com/rig-c/parts/commit/82d2d5b3bdb032ba22999d625b6bc032b0e451e7))
* **propose:** draft every lattice at the figure's spacing, round(H / 37), unless the part rule is asked for ([#265](https://github.com/rig-c/parts/issues/265)) ([#294](https://github.com/rig-c/parts/issues/294)) ([df11089](https://github.com/rig-c/parts/commit/df110892a917146ddf0f3c45ed37d95908d9edb3))


### Bug Fixes

* **propose:** the eye group, nose and mouth take the face's depth in the drafted turn ([#292](https://github.com/rig-c/parts/issues/292)) ([5767170](https://github.com/rig-c/parts/commit/5767170df44f2d8f1843344fd2ddb25f64ed0c94)), closes [#271](https://github.com/rig-c/parts/issues/271)

## [1.9.1](https://github.com/rig-c/parts/compare/v1.9.0...v1.9.1) (2026-10-12)


### Bug Fixes

* **determinism:** every length is sqrt(dx*dx + dy*dy) — no Math.hypot under src/ or in cli.ts ([#285](https://github.com/rig-c/parts/issues/285)) ([b7cf4e4](https://github.com/rig-c/parts/commit/b7cf4e4f096e5f0d281f21aa0b1cecaf33a7a936)), closes [#279](https://github.com/rig-c/parts/issues/279)
* **propose:** the drafted breath is 2.5 % of the neck-to-hip run, not of the topwear part's height ([#276](https://github.com/rig-c/parts/issues/276)) ([0a53820](https://github.com/rig-c/parts/commit/0a538206f2bf6a6c2466142e609d26d8f3a4719c))
* **rig:** when the unreduced source fails against itself, AUTO_MESH_MOTION says so — where (the stimulus by name), the row, the remedy ([#289](https://github.com/rig-c/parts/issues/289)) ([6fea4be](https://github.com/rig-c/parts/commit/6fea4be9cec30a8d83fa2574fafc97c11b87e215)), closes [#280](https://github.com/rig-c/parts/issues/280)

## [1.9.0](https://github.com/rig-c/parts/compare/v1.8.0...v1.9.0) (2026-10-11)


### Features

* **propose:** a turn control — one dial, each part carried by its See-through depth ([#267](https://github.com/rig-c/parts/issues/267)) ([0b5b1ce](https://github.com/rig-c/parts/commit/0b5b1ce8f3202ab5c094c9c1325853d4894c72f1))


### Bug Fixes

* **propose:** a skirt whose art starts below the chest hangs from the hip, and TIP_OVER_ROOT names a root the breath carries ([#269](https://github.com/rig-c/parts/issues/269)) ([f8ddcdd](https://github.com/rig-c/parts/commit/f8ddcddcd7dc50efc07908123b799a8656764c52))

## [1.8.0](https://github.com/rig-c/parts/compare/v1.7.0...v1.8.0) (2026-10-11)


### Features

* **propose:** draft a 40-frame idle whose breath travels 2.5 % of the torso's height, and read the loop's last frame within 1e-9 s ([#263](https://github.com/rig-c/parts/issues/263)) ([536f401](https://github.com/rig-c/parts/commit/536f40192ca9b90511528175c278fb4ff47bdb37)), closes [#244](https://github.com/rig-c/parts/issues/244) [#252](https://github.com/rig-c/parts/issues/252) [#262](https://github.com/rig-c/parts/issues/262)
* **propose:** the fringe chains stand in the head's frame, rooted on the art, and lint names a link that leaves the lock ([#264](https://github.com/rig-c/parts/issues/264)) ([e3e78e2](https://github.com/rig-c/parts/commit/e3e78e2bd84ab4a99fd6bc33ccff740a112604c3)), closes [#249](https://github.com/rig-c/parts/issues/249)
* **rig:** the head frame — head_up along the face's up axis, propose's frame notes, tipped face bones held by A51 ([#260](https://github.com/rig-c/parts/issues/260)) ([923cec8](https://github.com/rig-c/parts/commit/923cec81135a85d6b01b7974a913e644ffedf724))


### Bug Fixes

* **assemble:** a painting pixel's owner follows the plan's draw order, and a refused body another part holds is named ([#259](https://github.com/rig-c/parts/issues/259)) ([22f1423](https://github.com/rig-c/parts/commit/22f142341ba94ba316e19f23caf4b6e562ad6501)), closes [#255](https://github.com/rig-c/parts/issues/255)

## [1.7.0](https://github.com/rig-c/parts/compare/v1.6.0...v1.7.0) (2026-10-11)


### Features

* **build:** --lead-in for the idle loop of a rig with physics; the README loop shows the shipped demo ([#240](https://github.com/rig-c/parts/issues/240)) ([eb2ac4d](https://github.com/rig-c/parts/commit/eb2ac4d19c1e9ba66a7e9ad1afd20fbf7a5670c9)), closes [#224](https://github.com/rig-c/parts/issues/224)
* **propose:** a leg chain for the legwear part when the keypoints give hip, knee and ankle ([#248](https://github.com/rig-c/parts/issues/248)) ([3c9bb99](https://github.com/rig-c/parts/commit/3c9bb99de079b8faeea5839d224d14b4acd42c36)), closes [#241](https://github.com/rig-c/parts/issues/241)
* **propose:** with --keypoints, the trunk's mesh segments run along neck -&gt; hip ([#253](https://github.com/rig-c/parts/issues/253)) ([5a60cad](https://github.com/rig-c/parts/commit/5a60cad3da90a68d25790dd430b3a2eabd56f67f)), closes [#243](https://github.com/rig-c/parts/issues/243)
* **rig:** read the eye line through the eye bones and declare it as invariants.axes for rig-c 2.40.0's A51 ([#254](https://github.com/rig-c/parts/issues/254)) ([5d5e2aa](https://github.com/rig-c/parts/commit/5d5e2aae3b210b99572428c5078d0859a0cfd802)), closes [#239](https://github.com/rig-c/parts/issues/239)


### Bug Fixes

* **rig:** stand the face bones on the eye line and turn a single bone towards its tip ([#247](https://github.com/rig-c/parts/issues/247)) ([934f8e7](https://github.com/rig-c/parts/commit/934f8e71c1f3975ea680e8e78dd3ea0336f2c13a)), closes [#239](https://github.com/rig-c/parts/issues/239)

## [1.6.0](https://github.com/rig-c/parts/compare/v1.5.5...v1.6.0) (2026-10-11)


### Features

* **check:** a scene declares where the standing-figure bars do not hold — not_planted, not_swinging, rises ([#237](https://github.com/rig-c/parts/issues/237)) ([d176b47](https://github.com/rig-c/parts/commit/d176b47b3436b8737e87db36c6c651dcba67897a)), closes [#231](https://github.com/rig-c/parts/issues/231)
* **examples:** gestures, expressions and trailing strands on demo and scarf ([#236](https://github.com/rig-c/parts/issues/236)) ([cae0786](https://github.com/rig-c/parts/commit/cae0786535dd4a82a294d21a73137be135d5d2a7)), closes [#224](https://github.com/rig-c/parts/issues/224)


### Bug Fixes

* **assemble:** the proposed plan names a full-run body no planned part covers, and the summary names the layer its uncovered error lies on ([#238](https://github.com/rig-c/parts/issues/238)) ([aa85b17](https://github.com/rig-c/parts/commit/aa85b173e750d78cfd6bc800d2cd6600e1c598d9)), closes [#233](https://github.com/rig-c/parts/issues/233)
* **propose:** a cut's piece rides its trunk bone instead of taking its base's rule a second time ([#234](https://github.com/rig-c/parts/issues/234)) ([b84614a](https://github.com/rig-c/parts/commit/b84614a9a445adc467eac515f1e088440ad04402)), closes [#230](https://github.com/rig-c/parts/issues/230)

## [1.5.5](https://github.com/rig-c/parts/compare/v1.5.4...v1.5.5) (2026-10-11)


### Bug Fixes

* **docs:** the public examples repository is rig-c/parts-examples ([#228](https://github.com/rig-c/parts/issues/228)) ([1c95d36](https://github.com/rig-c/parts/commit/1c95d3670d80477cc0c032be04b4ce6bb010b646))
* **examples:** repaint the display demo with readable hands, keep the reference demo and sample as oracle fixtures ([#232](https://github.com/rig-c/parts/issues/232)) ([c82ddfc](https://github.com/rig-c/parts/commit/c82ddfcf5e4ff3801a98831045bb417133666c70))

## [1.5.4](https://github.com/rig-c/parts/compare/v1.5.3...v1.5.4) (2026-10-11)


### Bug Fixes

* **pkg:** the package is @rig-c/parts and the repository is rig-c/parts — rig-parts stays as an alias ([#223](https://github.com/rig-c/parts/issues/223)) ([796fcee](https://github.com/rig-c/parts/commit/796fcee89f0b19fd23da744b4b371cee6cd7d989))

## [1.5.3](https://github.com/firejune/rig-parts/compare/v1.5.2...v1.5.3) (2026-10-11)


### Bug Fixes

* **cli:** every unknown-flag refusal lists exactly the flags its command takes, read from one table the parsers read ([#220](https://github.com/firejune/rig-parts/issues/220)) ([3fed808](https://github.com/firejune/rig-parts/commit/3fed8080d1f9a54f57a7d4fe6355763f1083b269))

## [1.5.2](https://github.com/firejune/rig-parts/compare/v1.5.1...v1.5.2) (2026-10-11)


### Bug Fixes

* **check:** judge the seam's pixel count in rig pixels — the frame count divided by s² — so the bar means the same at every frame scale ([#217](https://github.com/firejune/rig-parts/issues/217)) ([216b4d4](https://github.com/firejune/rig-parts/commit/216b4d48adef765ddb7ffc631b556af2148ffd6f))
* **cli:** check's unknown-flag refusal names its two switches; README quotes the current seam line ([#219](https://github.com/firejune/rig-parts/issues/219)) ([2768a87](https://github.com/firejune/rig-parts/commit/2768a87baf3481b623bd522ccf911f39549fb10e))

## [1.5.1](https://github.com/firejune/rig-parts/compare/v1.5.0...v1.5.1) (2026-10-11)


### Bug Fixes

* **docs:** the thin-strand recipe is chain on the art plus stimulus, with the tracked chain's figures ([#214](https://github.com/firejune/rig-parts/issues/214)) ([8bd3fd2](https://github.com/firejune/rig-parts/commit/8bd3fd279a78f07d352bbaa95de87345abb87ae4))

## [1.5.0](https://github.com/firejune/rig-parts/compare/v1.4.0...v1.5.0) (2026-10-11)


### Features

* **compose:** take a build that fails only the bars named by --accept, and say so everywhere ([#208](https://github.com/firejune/rig-parts/issues/208)) ([a2adb56](https://github.com/firejune/rig-parts/commit/a2adb5680c39ca2889f2590ee6ce84ab41f94f55))
* **generate:** a control skeleton from a pose file, beside the two built-in standing poses ([#206](https://github.com/firejune/rig-parts/issues/206)) ([f9eec2d](https://github.com/firejune/rig-parts/commit/f9eec2d2d174dd74cc46a47ff50b1f519e42cb0e))
* **mesh:** a declared stimulus for the automatic mesh of a part only physics moves ([#211](https://github.com/firejune/rig-parts/issues/211)) ([a580eea](https://github.com/firejune/rig-parts/commit/a580eea413cb051f65fab324679e5de874d1a7f3))
* **propose:** a declared tolerance for a wrist that lies on no handwear part ([#213](https://github.com/firejune/rig-parts/issues/213)) ([7405ed8](https://github.com/firejune/rig-parts/commit/7405ed80ed3c0fce90449b5a07b2de1ddcdeaae0))


### Bug Fixes

* **check:** carry rig pixel centres onto frame pixel centres in the seam and source maps, so a figure rendered above scale 1 is not failed on registration ([#212](https://github.com/firejune/rig-parts/issues/212)) ([add91cd](https://github.com/firejune/rig-parts/commit/add91cd78219c5dc276acbd16f4a181fbd96d9ff))
* **examples:** put the scarf's robe_r chain on the tie it drives ([#210](https://github.com/firejune/rig-parts/issues/210)) ([5ce44f7](https://github.com/firejune/rig-parts/commit/5ce44f78ec6731e09ff1e591c0507ba24376a5be))

## [1.4.0](https://github.com/firejune/rig-parts/compare/v1.3.0...v1.4.0) (2026-10-11)


### Features

* **assemble:** an authored image of what lies under a cut piece, filled into the base where the cut removed its pixels ([#193](https://github.com/firejune/rig-parts/issues/193)) ([#200](https://github.com/firejune/rig-parts/issues/200)) ([00eea54](https://github.com/firejune/rig-parts/commit/00eea54d50e430ca41ccdd211f5158db5d5e9ee5))
* **compose:** a per-character scale beside the offset ([#205](https://github.com/firejune/rig-parts/issues/205)) ([60f6ee0](https://github.com/firejune/rig-parts/commit/60f6ee09127a91b5c0e9ba79546822fc55c05e7c))


### Bug Fixes

* **check:** the seam gate says where — each pair of parts, its boxes and a picture of the pixels it counted ([#204](https://github.com/firejune/rig-parts/issues/204)) ([2b75dfb](https://github.com/firejune/rig-parts/commit/2b75dfb6376ed13b75a0a9e8b426d013483ba228))

## [1.3.0](https://github.com/firejune/rig-parts/compare/v1.2.0...v1.3.0) (2026-10-10)


### Features

* **assemble:** cut a plan part's layer into a new part by a declared polygon ([#192](https://github.com/firejune/rig-parts/issues/192)) ([80fa416](https://github.com/firejune/rig-parts/commit/80fa4167435524c3da1d71707c42ec758892e16c))
* **examples:** prepare the sample rig for a bust and a hip jiggle ([#187](https://github.com/firejune/rig-parts/issues/187)) ([0ac6f31](https://github.com/firejune/rig-parts/commit/0ac6f31c409c10d43ab5c92b1065bca6d9711fbd))
* **mesh:** ribs along a chain — a row of vertices across the part at each link joint and at declared stations, in the contour and automatic modes ([#194](https://github.com/firejune/rig-parts/issues/194)) ([57ebabd](https://github.com/firejune/rig-parts/commit/57ebabdd87cf37292db32f226da9670726b98282))
* **scene:** carry a character's named animations through compose, and show sample's jiggle in a hop ([#195](https://github.com/firejune/rig-parts/issues/195)) ([6fcf3ea](https://github.com/firejune/rig-parts/commit/6fcf3ea90c5b00592b682435aeafd76a28635620))


### Bug Fixes

* **docs:** say how expressions and a jiggle are built on top of the rig ([#191](https://github.com/firejune/rig-parts/issues/191)) ([c69bd46](https://github.com/firejune/rig-parts/commit/c69bd46ba55bb2cf0ebadae08c65544583166a5f))

## [1.2.0](https://github.com/firejune/rig-parts/compare/v1.1.1...v1.2.0) (2026-10-10)


### Features

* **motion:** write the animations of a named rig-c motion file beside the idle on every build ([#186](https://github.com/firejune/rig-parts/issues/186)) ([12cf5ff](https://github.com/firejune/rig-parts/commit/12cf5ffe376f29280e0a0bdc8a6bf521aff42536))


### Bug Fixes

* **check:** measure the keyed loop with physics constraints left out, and report them on a line of their own ([#184](https://github.com/firejune/rig-parts/issues/184)) ([8aebe6e](https://github.com/firejune/rig-parts/commit/8aebe6e2fc50bb1fd4fee4b9dd0f99b3f5e22671))

## [1.1.1](https://github.com/firejune/rig-parts/compare/v1.1.0...v1.1.1) (2026-10-10)


### Bug Fixes

* **docs:** the headline says what the tool makes, and names Spine once as the format ([#181](https://github.com/firejune/rig-parts/issues/181)) ([9c4d3f3](https://github.com/firejune/rig-parts/commit/9c4d3f38c89e9c7ff51cc29b8de9cece1af979a1))

## [1.1.0](https://github.com/firejune/rig-parts/compare/v1.0.0...v1.1.0) (2026-10-10)


### Features

* **weights:** add bone heat as an opt-in per-mesh weight rule ([#180](https://github.com/firejune/rig-parts/issues/180)) ([69e6041](https://github.com/firejune/rig-parts/commit/69e6041b4d56bfe89c9259d9894dbdfdceacf25b))
* **weights:** let a mesh declare the distance rule's exponent, w = 1/(d + r)^exponent ([#178](https://github.com/firejune/rig-parts/issues/178)) ([e6d6a2f](https://github.com/firejune/rig-parts/commit/e6d6a2f9dd0fa7922531e535e6d4140541c68a62))

## [1.0.0](https://github.com/firejune/rig-parts/compare/v1.0.0-rc.1...v1.0.0) (2026-10-10)


### Features

* **mesh:** add a density-only auto region that refines without a bone or a band and leaves every source weight as without it ([#156](https://github.com/firejune/rig-parts/issues/156)) ([ee4e363](https://github.com/firejune/rig-parts/commit/ee4e363e8721455ceb1e97c275c4e4e1ddb8fd3d)), closes [#155](https://github.com/firejune/rig-parts/issues/155)
* **mesh:** clear the islands a declared stray leaves out from every reader of an automatic part, and name what was cleared ([#176](https://github.com/firejune/rig-parts/issues/176)) ([56b0c8b](https://github.com/firejune/rig-parts/commit/56b0c8bce5ab45f06482799d3ed8a68e7e08ae6d)), closes [#172](https://github.com/firejune/rig-parts/issues/172)
* **mesh:** derive the skinning envelope against the lowest common ancestor of the slot's bone and every bound bone, so the residual veto reaches parts skinned across sibling subtrees ([#169](https://github.com/firejune/rig-parts/issues/169)) ([6df4d90](https://github.com/firejune/rig-parts/commit/6df4d90ea186f73e71b2a3f95eac983a5ddfe47b)), closes [#165](https://github.com/firejune/rig-parts/issues/165)
* **release:** say that 1.0.0 holds the interface stable, and write the migration from 0.16.0 to 1.0.0 ([#177](https://github.com/firejune/rig-parts/issues/177)) ([7ee080b](https://github.com/firejune/rig-parts/commit/7ee080bbebaf5be403bdbf1fa74bc23ad7888fac)), closes [#172](https://github.com/firejune/rig-parts/issues/172)


### Bug Fixes

* **deps:** move to rig-c 2.32.1, which refuses a degenerate refinement insertion by name and cuts the reduction's wall time ([#163](https://github.com/firejune/rig-parts/issues/163)) ([0e836b9](https://github.com/firejune/rig-parts/commit/0e836b95f28cc06186070576a938ada84f7eb4f3)), closes [#159](https://github.com/firejune/rig-parts/issues/159)
* **deps:** move to rig-c 2.32.2, which no longer misrefuses a shared-edge tie in the motion comparison, and re-run the six spacing-survey cells it refused ([#166](https://github.com/firejune/rig-parts/issues/166)) ([5f8cccf](https://github.com/firejune/rig-parts/commit/5f8cccfb66e73ad19c02fbc1af25185277c43dff)), closes [#159](https://github.com/firejune/rig-parts/issues/159)
* **deps:** move to rig-c 2.33.0, the pin 1.0 ships with; every existing build byte-identical ([#173](https://github.com/firejune/rig-parts/issues/173)) ([3c207ac](https://github.com/firejune/rig-parts/commit/3c207acf3b2fdb604735872d45977ccb65b00415)), closes [#172](https://github.com/firejune/rig-parts/issues/172)
* **release:** say that 1.0.0, not the release candidate, holds the interface stable ([#158](https://github.com/firejune/rig-parts/issues/158)) ([b91d167](https://github.com/firejune/rig-parts/commit/b91d167317df03e444597b3dfc916fb7681135f9)), closes [#126](https://github.com/firejune/rig-parts/issues/126)

## [1.0.0-rc.1](https://github.com/firejune/rig-parts/compare/v0.16.0...v1.0.0-rc.1) (2026-10-09)


### Features

* **mesh:** a motion gate on the automatic mesh — the reduced mesh against its unreduced source on the idle through spine-rigc 2.20.3's compareMeshesInMotion, written only when it passes ([#134](https://github.com/firejune/rig-parts/issues/134)) ([8eb2989](https://github.com/firejune/rig-parts/commit/8eb298991ba470cdfdbc2f1fb0f7282f3e62c034))
* **mesh:** add an opt-in multi-interval replay selection that keeps the fewest-vertex passing step among a budgeted, deduplicated set of probes ([#151](https://github.com/firejune/rig-parts/issues/151)) ([8be4cd1](https://github.com/firejune/rig-parts/commit/8be4cd1778363f56661b2024aaeea3d6a248b60e))
* **mesh:** an automatic mesh mode — the contour mesh at alpha 1 and above reduced and locally refined by spine-rigc 2.19.0's reduceMesh, geometry only ([#131](https://github.com/firejune/rig-parts/issues/131)) ([c03dd8a](https://github.com/firejune/rig-parts/commit/c03dd8a7b547e88c3995134750711ccf61fa9a38)), closes [#126](https://github.com/firejune/rig-parts/issues/126)
* **mesh:** move to rig-c 2.20.4 under its new npm name, and regenerate the automatic-mesh evidence on it under per-cell caps with a re-running section ([#138](https://github.com/firejune/rig-parts/issues/138)) ([f405678](https://github.com/firejune/rig-parts/commit/f405678a7849800b12eead0a5463747e221a5fce))
* **mesh:** move to rig-c 2.22.0 and declare the permissive policy's undercut bound absent (null) instead of a stand-in number ([#139](https://github.com/firejune/rig-parts/issues/139)) ([95e0f61](https://github.com/firejune/rig-parts/commit/95e0f61b00b751588505473f493c4daa319d77d7))
* **mesh:** move to rig-c 2.23.0 and read the automatic source's overshoot 8-connected, and measure rigc[#1266](https://github.com/firejune/rig-parts/issues/1266) Q7 on the three motion-refused parts ([#140](https://github.com/firejune/rig-parts/issues/140)) ([926f433](https://github.com/firejune/rig-parts/commit/926f4336df800003262cdbdf3a9b7266e594162d))
* **mesh:** move to rig-c 2.24.0 and replay a less-reduced step when the motion gate refuses an automatic mesh's full reduction ([#141](https://github.com/firejune/rig-parts/issues/141)) ([952155c](https://github.com/firejune/rig-parts/commit/952155c19c0b4f59aefc46bdade40e59a6971f76)), closes [#126](https://github.com/firejune/rig-parts/issues/126)
* **mesh:** move to rig-c 2.28.0, read acceptedAt per operation, and take the Stage B opt-ins as author fields with the public inputs rerun under each ([#147](https://github.com/firejune/rig-parts/issues/147)) ([9420934](https://github.com/firejune/rig-parts/commit/942093437904530f86c27210a2fbdb88b1c6600e)), closes [#126](https://github.com/firejune/rig-parts/issues/126)
* **mesh:** move to rig-c 2.29.0, send the motion amplitude with the author's gradation or null on the reduction and the comparison, and carry MQ_DEFORM_LOAD measured ([#150](https://github.com/firejune/rig-parts/issues/150)) ([8e3553a](https://github.com/firejune/rig-parts/commit/8e3553af207b5c8c022282fe204a6fd20ce861f2))
* **mesh:** move to rig-c 2.31.0 and take the skinning residual as an opt-in per-step veto, with the envelope derived from the idle and the motion comparison still deciding ([#152](https://github.com/firejune/rig-parts/issues/152)) ([22b2c5a](https://github.com/firejune/rig-parts/commit/22b2c5ab78bc2f7a5a519234c9fb30274f1c447f)), closes [#126](https://github.com/firejune/rig-parts/issues/126)
* **package:** rename the package to rig-parts, keeping spine-parts as a transition command and the SPINE_PARTS_* variables as fallbacks ([#142](https://github.com/firejune/rig-parts/issues/142)) ([96f28b1](https://github.com/firejune/rig-parts/commit/96f28b1f77d022828096ff198972cc1ccc3fb830)), closes [#126](https://github.com/firejune/rig-parts/issues/126)
* **release:** publish spine-parts as an alias of rig-parts from the one gated tree, and confirm both names on the registry ([#144](https://github.com/firejune/rig-parts/issues/144)) ([84a951e](https://github.com/firejune/rig-parts/commit/84a951ed1fed22afafe0cb10c672eeadd06ac3dc)), closes [#126](https://github.com/firejune/rig-parts/issues/126)
* **release:** state the 1.0.0-rc.1 interface and the migration from 0.16.0, and hold the stability page to the CLI and the config loader ([#154](https://github.com/firejune/rig-parts/issues/154)) ([c911e48](https://github.com/firejune/rig-parts/commit/c911e48a6cb186997caffa5f9eb9a2df9540a00b)), closes [#126](https://github.com/firejune/rig-parts/issues/126)


### Bug Fixes

* **deps:** move to rig-c 2.24.1, and measure rigc[#1271](https://github.com/firejune/rig-parts/issues/1271) Q8 on the public examples with Q1 option (ii) tried ([#146](https://github.com/firejune/rig-parts/issues/146)) ([542da46](https://github.com/firejune/rig-parts/commit/542da4695f6f56df0433f572da85990a83d5ef19)), closes [#126](https://github.com/firejune/rig-parts/issues/126)
* **mesh:** write every lattice and contour triangle counter-clockwise in Spine world, and hand the automatic mode's source to spine-rigc untouched ([#133](https://github.com/firejune/rig-parts/issues/133)) ([4a126fe](https://github.com/firejune/rig-parts/commit/4a126fefd1a7a960b10c2ebc3da0d866a42589ca)), closes [#126](https://github.com/firejune/rig-parts/issues/126)


### Performance Improvements

* **build:** compile the motion gate's reference without packing, and run each matrix cell's reduction once ([#137](https://github.com/firejune/rig-parts/issues/137)) ([494c919](https://github.com/firejune/rig-parts/commit/494c9195ec0e25113a30015432cd8e05b2db4353))

## [0.16.0](https://github.com/firejune/spine-parts/compare/v0.15.2...v0.16.0) (2026-10-07)


### Features

* **compose:** bind finished single-character builds into one rig with prefixed names, a background plate and a declared slot order ([#129](https://github.com/firejune/spine-parts/issues/129)) ([55a7adc](https://github.com/firejune/spine-parts/commit/55a7adc20154031295899bbbf62db63b6da88b4d)), closes [#74](https://github.com/firejune/spine-parts/issues/74)

## [0.15.2](https://github.com/firejune/spine-parts/compare/v0.15.1...v0.15.2) (2026-10-07)


### Bug Fixes

* **check:** read STILL_REGIONS_DARK from the posed geometry — the still set keeps its place relative to the head bone to the arithmetic's rounding, and the bangs' swing over the face is reported ([#127](https://github.com/firejune/spine-parts/issues/127)) ([7850291](https://github.com/firejune/spine-parts/commit/7850291c86e088dcbeca6432deb68b4dd8d63bc3)), closes [#123](https://github.com/firejune/spine-parts/issues/123) [#118](https://github.com/firejune/spine-parts/issues/118)

## [0.15.1](https://github.com/firejune/spine-parts/compare/v0.15.0...v0.15.1) (2026-10-07)


### Bug Fixes

* **check:** measure TIP_OVER_ROOT from the posed geometry, exactly, so the render grid no longer decides it ([#124](https://github.com/firejune/spine-parts/issues/124)) ([165c0bd](https://github.com/firejune/spine-parts/commit/165c0bdb842280a7bcf976c46dd059bc880ab50e)), closes [#118](https://github.com/firejune/spine-parts/issues/118) [#108](https://github.com/firejune/spine-parts/issues/108)

## [0.15.0](https://github.com/firejune/spine-parts/compare/v0.14.0...v0.15.0) (2026-10-07)


### Features

* **examples:** add `scarf`, a third public example with a hanging scarf, its proposal unedited and four painting patches, held to its own build ([#122](https://github.com/firejune/spine-parts/issues/122)) ([98f76ca](https://github.com/firejune/spine-parts/commit/98f76ca94589e22e8cae8c7b0ea4478168cdf256)), closes [#108](https://github.com/firejune/spine-parts/issues/108) [#118](https://github.com/firejune/spine-parts/issues/118)


### Bug Fixes

* **assemble:** push back a fringe below alpha 250 where the painting shows the part beneath it, so another garment's colour no longer draws as a line down it ([#120](https://github.com/firejune/spine-parts/issues/120)) ([d1df125](https://github.com/firejune/spine-parts/commit/d1df12525f5796a338c2fee15545f465105f1521)), closes [#119](https://github.com/firejune/spine-parts/issues/119) [#108](https://github.com/firejune/spine-parts/issues/108)

## [0.14.0](https://github.com/firejune/spine-parts/compare/v0.13.1...v0.14.0) (2026-10-07)


### Features

* **check:** a declared `seam` requirement measures how far two parts' art parts over an animation, naming the pair and the frame ([#116](https://github.com/firejune/spine-parts/issues/116)) ([6cae59a](https://github.com/firejune/spine-parts/commit/6cae59a306ba9eba9d1224b54635823838b61fe8))

## [0.13.1](https://github.com/firejune/spine-parts/compare/v0.13.0...v0.13.1) (2026-10-06)


### Bug Fixes

* **contour:** cut the outline at a region's spacing where it passes through the region's band, so one long edge no longer carries the whole falloff ([#114](https://github.com/firejune/spine-parts/issues/114)) ([5567970](https://github.com/firejune/spine-parts/commit/5567970e83c20e38422d9ddd44adbe9fa900e958)), closes [#110](https://github.com/firejune/spine-parts/issues/110) [#108](https://github.com/firejune/spine-parts/issues/108)
* **contour:** grow the filled silhouette by the margin and trace it, instead of offsetting the outline, so a narrow notch grows shut rather than folding ([#112](https://github.com/firejune/spine-parts/issues/112)) ([d2d961c](https://github.com/firejune/spine-parts/commit/d2d961c6a3a4c905ba8431992853f0187a77be87)), closes [#106](https://github.com/firejune/spine-parts/issues/106)

## [0.13.0](https://github.com/firejune/spine-parts/compare/v0.12.0...v0.13.0) (2026-10-06)


### Features

* **constraints:** take spine-rigc ^2.15.0, whose parser refuses an ik's bones as a shape, retire this package's two ik refusals and add --idle-keys direct to rigc's line where a control splits the pair ([#105](https://github.com/firejune/spine-parts/issues/105)) ([b1e4df1](https://github.com/firejune/spine-parts/commit/b1e4df1a9adee233ee83398b923d4b998b81f999)), closes [#103](https://github.com/firejune/spine-parts/issues/103)
* **contour:** build a contour mesh from rigc's outline with declared interior points and an exact constrained Delaunay triangulation ([#100](https://github.com/firejune/spine-parts/issues/100)) ([c6f38c3](https://github.com/firejune/spine-parts/commit/c6f38c3878077ed1644dde7557d2c424a9382b7d)), closes [#84](https://github.com/firejune/spine-parts/issues/84)
* **rig:** wire the contour mesh mode — config, stray islands, local region weights, and the lattice comparison ([#104](https://github.com/firejune/spine-parts/issues/104)) ([14eeb2c](https://github.com/firejune/spine-parts/commit/14eeb2c8ce9a11a6f02740f82b9780f208843652)), closes [#84](https://github.com/firejune/spine-parts/issues/84)

## [0.12.0](https://github.com/firejune/spine-parts/compare/v0.11.0...v0.12.0) (2026-10-06)


### Features

* **build:** take --idle-keys ctl|direct and forward it to the rig stage, so a two-bone ik over keyed chain links builds in one process ([#98](https://github.com/firejune/spine-parts/issues/98)) ([ad774c1](https://github.com/firejune/spine-parts/commit/ad774c10e8b7146fd1a4e8f0fe80f52d884f02c3)), closes [#95](https://github.com/firejune/spine-parts/issues/95)
* **check:** measure a scene's declared motion requirements from spine-rigc's posed frames under --requirements ([#97](https://github.com/firejune/spine-parts/issues/97)) ([4ac2e8a](https://github.com/firejune/spine-parts/commit/4ac2e8a72ad043c95d7c0f37bc93a267d2383464)), closes [#93](https://github.com/firejune/spine-parts/issues/93)
* **config:** pass spine-rigc's own constraints through the config, resolve their bones by name, and declare scene targets detached ([#94](https://github.com/firejune/spine-parts/issues/94)) ([818c627](https://github.com/firejune/spine-parts/commit/818c6278cf1ca42096ae3cd31b19ff7c33aa2375)), closes [#92](https://github.com/firejune/spine-parts/issues/92)

## [0.11.0](https://github.com/firejune/spine-parts/compare/v0.10.0...v0.11.0) (2026-10-06)


### Features

* **compare:** compare two skeletons by structure through an explicit bone map ([#88](https://github.com/firejune/spine-parts/issues/88)) ([2452dc6](https://github.com/firejune/spine-parts/commit/2452dc6079c8a2e84370302b091e221717191acb)), closes [#85](https://github.com/firejune/spine-parts/issues/85)
* **propose:** read a posed figure's joints from one explicit keypoint file, place the torso and sleeves from them, and lint by the relations they declare ([#90](https://github.com/firejune/spine-parts/issues/90)) ([4038702](https://github.com/firejune/spine-parts/commit/403870207959fde22bb6296d94a7337dfbba1607)), closes [#75](https://github.com/firejune/spine-parts/issues/75)
* **propose:** say per bone which check read it or why none did, and write beside the proposal what each bone rests on ([#91](https://github.com/firejune/spine-parts/issues/91)) ([e86444c](https://github.com/firejune/spine-parts/commit/e86444ca7282ca0b58aa136f362322f9287db45a)), closes [#86](https://github.com/firejune/spine-parts/issues/86)

## [0.10.0](https://github.com/firejune/spine-parts/compare/v0.9.0...v0.10.0) (2026-10-06)


### Features

* **check:** measure a rig spec with no parts.json or no idle, SKIP by name, and add SETUP_POSE_VS_SOURCE under --source ([#82](https://github.com/firejune/spine-parts/issues/82)) ([989aa00](https://github.com/firejune/spine-parts/commit/989aa00542edce052e6f90d6a0cf9ee1c253ee57)), closes [#77](https://github.com/firejune/spine-parts/issues/77)
* **inputs:** a landscape painting is padded onto its square vertically, and every stage maps the full run back through both pads ([#79](https://github.com/firejune/spine-parts/issues/79)) ([c7a6bdd](https://github.com/firejune/spine-parts/commit/c7a6bdd02c5a7695300d4014b79278eae95a984c)), closes [#78](https://github.com/firejune/spine-parts/issues/78)
* **propose:** a face-less figure gets a proposal, its face box derived from the head run's hair and neck by measured ratios ([#83](https://github.com/firejune/spine-parts/issues/83)) ([88b88f4](https://github.com/firejune/spine-parts/commit/88b88f4868cf40079a9feed2c031cf3d16ef87e7)), closes [#76](https://github.com/firejune/spine-parts/issues/76)
* **rig:** turn each chain bone along its chain and give it a length, without moving anything ([#81](https://github.com/firejune/spine-parts/issues/81)) ([76a3189](https://github.com/firejune/spine-parts/commit/76a31894d7e3bead213460051a73dbf4e3e4bb2f)), closes [#73](https://github.com/firejune/spine-parts/issues/73)

## [0.9.0](https://github.com/firejune/spine-parts/compare/v0.8.2...v0.9.0) (2026-10-05)


### Features

* **config:** a project's own records ride under x- keys, read by nothing — and the painting meta names its sampler fields ([#71](https://github.com/firejune/spine-parts/issues/71)) ([a91d54f](https://github.com/firejune/spine-parts/commit/a91d54fd4b388ecdf044e83a9ce89e58a9298004)), closes [#70](https://github.com/firejune/spine-parts/issues/70)

## [0.8.2](https://github.com/firejune/spine-parts/compare/v0.8.1...v0.8.2) (2026-10-04)


### Bug Fixes

* **deps:** take up spine-rigc 2.10.1 — the header is the setup-pose box, held to getBounds by the atlas instrument; stale sentences made true ([#68](https://github.com/firejune/spine-parts/issues/68)) ([2277d86](https://github.com/firejune/spine-parts/commit/2277d86e406f833371de4447d8e5a67dcc7d5d1e)), closes [#67](https://github.com/firejune/spine-parts/issues/67)

## [0.8.1](https://github.com/firejune/spine-parts/compare/v0.8.0...v0.8.1) (2026-10-03)


### Bug Fixes

* **config:** two tracks on one bone property are refused by the loader, before rigc ([#65](https://github.com/firejune/spine-parts/issues/65)) ([6cf8ac9](https://github.com/firejune/spine-parts/commit/6cf8ac9786a384127867b59bbcdccc74b11656bc)), closes [#49](https://github.com/firejune/spine-parts/issues/49)

## [0.8.0](https://github.com/firejune/spine-parts/compare/v0.7.0...v0.8.0) (2026-10-03)


### ⚠ BREAKING CHANGES

* **check:** the default packed page changes (polygon); --pack-shape rect restores 0.7.0's page. check.json gains a key, pack_mode, after rigc_entry. A rigc older than 2.1.0 on PATH is refused (CHECK_PACK_SHAPE) under the default.

### Features

* **check:** take up spine-rigc 2.1 — read the pack line that ends in its shape, pass --pack-shape through with polygon as the default, and record pack_mode in check.json ([#63](https://github.com/firejune/spine-parts/issues/63)) ([6ed8e4d](https://github.com/firejune/spine-parts/commit/6ed8e4d159f414e67d202368a35a78df2733b828))

## [0.7.0](https://github.com/firejune/spine-parts/compare/v0.6.0...v0.7.0) (2026-10-02)


### ⚠ BREAKING CHANGES

* **rigc:** an install of spine-parts no longer carries spine-core, and its build is gated by rigc's own validator (cli_core.ts); the spine-core round trip runs in this repository's selftest and CI. check.json drops gate_spine_green and adds rigc_entry; check no longer writes gate_spine.txt.

### Features

* **rigc:** take up spine-rigc 2.0 — rig gates through rigc's launcher like check, build's spine-html gate is the one gate, a rigc that stops before its gate prints is quoted, both entries' reports are read by name and check.json records the entry ([#60](https://github.com/firejune/spine-parts/issues/60)) ([992a8fd](https://github.com/firejune/spine-parts/commit/992a8fd009c4a475387897f46e75d1a6da396ffe))

## [0.6.0](https://github.com/firejune/spine-parts/compare/v0.5.0...v0.6.0) (2026-10-01)


### Features

* **check:** the packed page takes rigc's --page-edges, free by default — the examples' pages go from 1024x2048 to 967x1338 and 512x2048 to 479x1166, and --page-edges pot keeps the earlier bytes ([#57](https://github.com/firejune/spine-parts/issues/57)) ([7ab56b4](https://github.com/firejune/spine-parts/commit/7ab56b421fa140278f6211b726eb8ce1906c9944))


### Instrument

* **tools:** atlas_population measures the editor's example atlases and ours with one instrument — regions, page opaque share, figure size at atlas scale ([#55](https://github.com/firejune/spine-parts/issues/55)) ([610bde8](https://github.com/firejune/spine-parts/commit/610bde8715830eadbc5b105cdc3ef66f7975f17a)), closes [#54](https://github.com/firejune/spine-parts/issues/54)

## [0.5.0](https://github.com/firejune/spine-parts/compare/v0.4.0...v0.5.0) (2026-09-28)


### Features

* **check:** TEXTURE_STRETCH measures every mesh triangle's edge stretch over the idle from rigc's geometry export — the reference guide's judgement 6 leaves the eye-only list ([#52](https://github.com/firejune/spine-parts/issues/52)) ([0283a6b](https://github.com/firejune/spine-parts/commit/0283a6b69b084168235d6025c49a722199a01bb1)), closes [#31](https://github.com/firejune/spine-parts/issues/31)


### Bug Fixes

* **check:** STILL_REGIONS_DARK measures the face in the head's own frame — a 2 px slide the screen-space bar let through is now red ([#53](https://github.com/firejune/spine-parts/issues/53)) ([b0d3efe](https://github.com/firejune/spine-parts/commit/b0d3efe45f3a0ce38963b56d355a205b269b4533))
* **propose:** irides without an eyewhite are placed as still regions with the cause in the note, and a blink group naming a bone twice is refused before rigc ([#51](https://github.com/firejune/spine-parts/issues/51)) ([ec963c1](https://github.com/firejune/spine-parts/commit/ec963c18f68ae3b1019ca1c2e7dc5b91263a1eef))


### Documentation

* **seethrough:** upstream's two stages, read at a named revision and measured against our head-crop run — what each route needs ([#48](https://github.com/firejune/spine-parts/issues/48)) ([912c699](https://github.com/firejune/spine-parts/commit/912c699b7ce6a77f500b8b2a9a2112a69bec57a2)), closes [#10](https://github.com/firejune/spine-parts/issues/10)

## [0.4.0](https://github.com/firejune/spine-parts/compare/v0.3.0...v0.4.0) (2026-09-28)


### Features

* **rig:** --idle-keys ctl|direct — the _ctl indirection measured against direct keys with rigc 1.3.0's idleDrivesMeshes declaration ([#43](https://github.com/firejune/spine-parts/issues/43)) ([8a450cc](https://github.com/firejune/spine-parts/commit/8a450cc59c81052fe9008ea71c9bfae45d62cdd7))


### Bug Fixes

* **motion:** the blink's hold spans a loop frame — the 12 fps idle now shows the closed eye on both examples, and the README animation blinks ([#46](https://github.com/firejune/spine-parts/issues/46)) ([48e3e61](https://github.com/firejune/spine-parts/commit/48e3e610524d7b43b190fcfc3a14678533aaff12))
* **propose:** a figure with no eye parts gets no blink — propose says so, and a config with an empty blink group is refused before rigc sees it ([#47](https://github.com/firejune/spine-parts/issues/47)) ([8bc20b4](https://github.com/firejune/spine-parts/commit/8bc20b4dbb41f7403a1b5d0b25b779c8992e5363))

## [0.3.0](https://github.com/firejune/spine-parts/compare/v0.2.0...v0.3.0) (2026-09-27)


### Features

* **assemble:** --propose-plan drops a layer that is mostly translucent, background-coloured or out of proportion, and says which rule — layers prints the three figures ([#39](https://github.com/firejune/spine-parts/issues/39)) ([84ac886](https://github.com/firejune/spine-parts/commit/84ac8861b3c2a28dd23e52eae348ba9707638fc9)), closes [#21](https://github.com/firejune/spine-parts/issues/21)
* **assemble:** assemble.patches cuts an extra part from the painting with a painting: provenance that parts.json, propose and check accept — and check --parts says what it takes ([#42](https://github.com/firejune/spine-parts/issues/42)) ([e44b01d](https://github.com/firejune/spine-parts/commit/e44b01dc48e6858a246842ff409b2f7bb785798f))
* **assemble:** the recomposite error is a map and a list of uncovered holes with their boxes, and check reports it as a line no gate can see ([#40](https://github.com/firejune/spine-parts/issues/40)) ([6629d5c](https://github.com/firejune/spine-parts/commit/6629d5c217b1fe9b586df1ce095eb1f9c2a82384))
* **propose:** hanging strands on an accessory are found, noted and given pendulum chains instead of hanging stiff on a fixed bone ([#37](https://github.com/firejune/spine-parts/issues/37)) ([fff0b84](https://github.com/firejune/spine-parts/commit/fff0b84fc8d6abdefd01df8ede4181b0e48fbc7d))


### Bug Fixes

* **assemble:** assemble reads the config through the early door — plan and seethrough are all it needs before propose — and a control runs the README loop in order on a fresh config ([#41](https://github.com/firejune/spine-parts/issues/41)) ([92b0eed](https://github.com/firejune/spine-parts/commit/92b0eedbf495d136f1d9e11bf344c811a46530e1))
* **propose:** hip comes from the waist and is linted against the chest; clasped hands are one region rather than two sleeve chains on one line ([#34](https://github.com/firejune/spine-parts/issues/34)) ([8515ffe](https://github.com/firejune/spine-parts/commit/8515ffe49f814e5af1c7effc7ec77c14f934c145))
* **rig:** a lash that reaches above the lid is cut at a clear row into a still piece — the eyelid crease no longer squashes, and the rest pose is byte-identical ([#38](https://github.com/firejune/spine-parts/issues/38)) ([7d6bd6a](https://github.com/firejune/spine-parts/commit/7d6bd6a424e0ba031d0534db0a9f0a80eba10524)), closes [#26](https://github.com/firejune/spine-parts/issues/26)

## [0.2.0](https://github.com/firejune/spine-parts/compare/v0.1.0...v0.2.0) (2026-09-27)


### Features

* **assemble:** parts.json counts visible, occluded and visible-but-not-projected pixels apart, and --project visible takes every visible pixel of a thin part from the painting ([#29](https://github.com/firejune/spine-parts/issues/29)) ([986a0a9](https://github.com/firejune/spine-parts/commit/986a0a9100acac1e891d8f580d89db2e52e227b0)), closes [#9](https://github.com/firejune/spine-parts/issues/9)
* **check:** six of the reference guide's eye-only judgements become named check lines — breath, blink hole, chain lag, tip over root, still regions — each with its bar and its SKIP ([#30](https://github.com/firejune/spine-parts/issues/30)) ([27f24ec](https://github.com/firejune/spine-parts/commit/27f24ec7dcb4b46f9ed29ee528a56937ceb088c3))
* **loop:** an indexed APNG with a shared palette — the README-sized animation is lossless PNG structure with a measured palette error ([#27](https://github.com/firejune/spine-parts/issues/27)) ([5e85bb0](https://github.com/firejune/spine-parts/commit/5e85bb0145222e6df7774afb8961a204b3b4e491))


### Bug Fixes

* **comfy:** comfy paint reads the config through the early door — key and generation are all it needs ([#18](https://github.com/firejune/spine-parts/issues/18)) ([c5c01be](https://github.com/firejune/spine-parts/commit/c5c01beb86f105107e8496b97e4d902262c5a7f8)), closes [#17](https://github.com/firejune/spine-parts/issues/17)

## 0.1.0 (2026-09-27)


### Features

* **assemble:** merge the full and head See-through runs into rig-space parts, measured against the reference ([#14](https://github.com/firejune/spine-parts/issues/14)) ([6c2602a](https://github.com/firejune/spine-parts/commit/6c2602ad6f8239abf46e0a87a0ad221569dbd695))
* **build:** one command from painting to packed atlas, an end-to-end examples chain, and the 0.1.0 README, authoring guide, skill and demo ([#16](https://github.com/firejune/spine-parts/issues/16)) ([9ed1183](https://github.com/firejune/spine-parts/commit/9ed11834418333ec0f9d267ce6b46750fe883922))
* **check:** build, gate, render and measure a rig through spine-rigc, and encode its idle as APNG and GIF ([#8](https://github.com/firejune/spine-parts/issues/8)) ([722e67b](https://github.com/firejune/spine-parts/commit/722e67b28943aeaf02aef20aaffb04ecfe74addc))
* **comfy:** the optional ComfyUI adapter (comfy paint, comfy seethrough) and the inputs command ([#15](https://github.com/firejune/spine-parts/issues/15)) ([a9c778a](https://github.com/firejune/spine-parts/commit/a9c778a6e98335fe2af38e674fdb57920443c279))
* **examples:** two public example characters, fetched inputs, and a corpus suite that reads them ([#3](https://github.com/firejune/spine-parts/issues/3)) ([7f4b4af](https://github.com/firejune/spine-parts/commit/7f4b4afa204f6271bfef4b8bb637f5a307589790))
* **propose:** bones, meshes, regions and an idle from the parts' tags, the overlay to correct against, LINT, compare and a head box held inside the painting ([#5](https://github.com/firejune/spine-parts/issues/5)) ([a00fe94](https://github.com/firejune/spine-parts/commit/a00fe940250d9af068064d676cfe0207ab4e7fd9))
* **rig:** author rig.json and motion.json from the config and the parts — lattice meshes, segment weights, regions, the idle — and write them only after spine-rigc is green on them ([#4](https://github.com/firejune/spine-parts/issues/4)) ([e8165bc](https://github.com/firejune/spine-parts/commit/e8165bcd98054fae33a98af4306fbf9c1a485bac))
