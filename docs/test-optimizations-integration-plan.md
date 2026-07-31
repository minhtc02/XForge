# Kế hoạch tích hợp: XForge Test Optimizations

> Nguồn: `~/Downloads/test_optimizations_plan.md` (Braly-inspired optimizations).
> Tài liệu này = **đánh giá tài liệu nguồn** + **kế hoạch tích hợp đã hiệu chỉnh**
> theo kiến trúc thực tế của `packages/test-core` tại commit `3298f3d`.

---

## 1. Kết luận nhanh

Bốn hướng tối ưu trong tài liệu nguồn (Navigation Graph, System-level State,
Live Reconcile, Verification Agent) đều **đúng hướng chiến lược** và đều khả thi
trên kiến trúc hiện tại. Nhưng kế hoạch thực thi cần sửa 6 điểm trước khi code,
trong đó có 2 lỗi kỹ thuật (lệnh không tồn tại / danh sách permission sai), 1 lỗi
thứ tự (probe không tiết kiệm được build), 1 xung đột kiến trúc (simctl không chèn
được vào giữa một `xcodebuild` invocation), và **1 lỗ hổng lớn hơn tất cả các
hạng mục trong tài liệu mà tài liệu không nêu ra**.

**Việc nên làm đầu tiên không nằm trong tài liệu nguồn**: generator XCUITest hiện
tại gần như **không sinh assertion nào**. Đây mới chính là "Exit-0 Trap" đang tồn
tại thật trong XForge, và sửa nó rẻ hơn + có giá trị cao hơn cả 4 phase kia.

---

## 2. Đánh giá chi tiết tài liệu nguồn

### 2.1. Những điểm đánh giá hiện trạng — CHÍNH XÁC

| Nhận định trong tài liệu                                       | Xác nhận trong code                                                                                                                 |
| :------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| Kiến trúc tách bạch config / planning / generation / execution | Đúng — `config/`, `planning/`, `generation/`, `execution/`                                                                          |
| Có lifecycle simulator, retry infra, sharding song song        | Đúng — `execution/simulator.ts:14` (`WORKER_LIFECYCLE`), `orchestrator.ts:88` (`retry_infrastructure_failure`), `planning/shard.ts` |
| Ưu tiên `accessibilityIdentifier`, hạn chế toạ độ              | Đúng — `generation/xcuitest.ts` chỉ dùng locator theo id/label                                                                      |
| Static planning tuyến tính, giả định spec luôn đúng            | Đúng — `case-generator.ts:113-178` sinh step cứng `launch-app → open → …`                                                           |
| Phụ thuộc in-app mocking qua `--xforge-test`                   | Đúng — `xcuitest.ts:31` + `generateTestSupportFile()`                                                                               |
| Thiếu navigation tự tìm đường và live reconcile                | Đúng                                                                                                                                |

### 2.2. Sáu điểm cần hiệu chỉnh

#### (1) `xcrun simctl ui <udid> dump` KHÔNG TỒN TẠI — lỗi chặn Phase 3 của tài liệu

Đã kiểm chứng trên máy (`xcrun simctl help ui`). `simctl ui` chỉ hỗ trợ:
`appearance`, `increase_contrast`, `content_size`. **Không có subcommand `dump`**,
và `simctl` không có bất kỳ API dump A11y tree nào.

Ba đường thay thế thật sự khả dụng:

| Đường                                                                                                                           | Chi phí                                          | Đánh giá                                                                           |
| :------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------- | :--------------------------------------------------------------------------------- |
| **A. Sinh 1 XCUITest "probe class"** duyệt `XCUIApplication().descendants(matching: .any)` rồi ghi JSON tree ra `XCTAttachment` | Cần app đã build + 1 invocation `-only-testing:` | ✅ **Khuyến nghị** — tự chứa, không thêm dependency, tái dùng đúng generator đã có |
| **B. `idb ui describe-all`** (Facebook IDB)                                                                                     | Thêm external dependency, phải cài qua brew/pip  | ⚠️ Optional adapter, detect trong `test doctor`                                    |
| **C. Quét tĩnh `accessibilityIdentifier(...)` từ Swift source**                                                                 | **0 chi phí, offline, không cần simulator**      | ✅ **Khuyến nghị làm TRƯỚC** — xem Phase 2                                         |

#### (2) Bảng "Bucket Trạng thái" sai về `simctl privacy`

Danh sách service thật (đã verify `xcrun simctl privacy`):

```
all, calendar, contacts-limited, contacts, location, location-always,
photos-add, photos, media-library, microphone, motion, reminders, siri
```

→ **`camera` KHÔNG có trong danh sách. `notifications` cũng KHÔNG có.**

Tài liệu ghi "Bật/tắt camera, location" — location đúng, camera sai. Đây là hai
permission phổ biến nhất trong app iOS, nên phải có đường xử lý riêng:

- **Camera / Notifications**: không grant được bằng `simctl` → phải sinh
  `addUIInterruptionMonitor` trong XCUITest, hoặc mock qua `XForgeTestSupport`.
  Đồng thời `testability.ts` phải raise issue `permission-not-simctl-grantable`
  để plan nói rõ trước khi chạy (nguyên tắc §4.1: không phát hiện giữa chừng).
- Ba mục còn lại trong bảng (`uninstall`, `openurl`, `push`) **đều đúng và tồn tại**.

Lưu ý thêm: `simctl privacy` in cảnh báo rằng bypass permission có thể **che giấu bug**
(app thiếu Info.plist usage key vẫn chạy được). Nên `state.grant_permissions` phải là
config opt-in, mặc định `false` cho level `full`, và ghi vào `permissions.md`.

#### (3) Live Reconcile KHÔNG tiết kiệm được thời gian build — sai về thứ tự

Tài liệu nói probe giúp "từ chối sinh Test Plan, tiết kiệm thời gian chạy
xcodebuild vô ích". Nhưng để duyệt A11y tree thì **app phải được build và cài
trước** → probe nằm **sau** `build-for-testing`, không thể nằm trong
`xforge test plan` (vốn hoàn toàn offline, xem `apps/cli/src/commands/test/plan.ts`).

Giá trị thật của probe vẫn lớn, nhưng phải phát biểu lại cho đúng:

- ❌ Không tiết kiệm được build (XForge vốn đã **build-once**, `simulator.ts:61`).
- ✅ Tiết kiệm **ma trận test đầy đủ**: 1 probe run ~30s thay vì N shard × M case
  đều fail bằng timeout 5s (`waitForExistence(timeout: 5)`).
- ✅ Cho ra **DEVIATION có bằng chứng** thay vì một đống `FAIL_FUNCTIONAL` nhiễu
  mà `triage.ts` sẽ phân loại nhầm thành lỗi sản phẩm.

→ Probe thuộc **execution pipeline** (gate giữa build và test matrix), không thuộc
planning. Phần "từ chối sinh plan" chỉ khả thi với reconcile **tĩnh** (điểm 1.C).

#### (4) Xung đột kiến trúc: simctl không chèn được vào giữa một shard

Đây là điểm quan trọng nhất về mặt thiết kế. Hiện tại orchestrator chạy **một**
`xcodebuild test-without-building` cho mỗi shard (`orchestrator.ts:91-127`), và
shard = toàn bộ case của một feature (`shard.ts`). Trong khi đó `simctl` chạy ở
**host process**, ngoài process test.

→ Không thể thực hiện `deep-link` ở step 3 của case A rồi `set-permission` ở step 2
của case B khi cả hai nằm trong cùng một invocation. Test step kiểu OS-level
**không thể là một step tuỳ ý trong `TestStep`** như tài liệu đề xuất (Tác vụ 3,
Phase 1).

Giải pháp — khái niệm **State Bucket**:

```
StateBucket = { fresh_install?, permissions?, deep_link?, push_payload?,
                appearance?, content_size?, locale? }
```

- Bucket gắn ở **precondition của case**, không phải step.
- Sharding sinh thêm chiều: cases cùng `(feature, bucket_hash)` → cùng shard.
- Orchestrator: mỗi shard = `[simctl setup commands…] → xcodebuild -only-testing:… → collect`.
- Cần bổ sung `-only-testing:` vào `testWithoutBuildingCommand()` — thay đổi nhỏ,
  đòn bẩy lớn, mở khoá cả bucket lẫn retry-per-case sau này.

Trade-off phải nói thẳng với người dùng: mỗi bucket = thêm 1 invocation
`xcodebuild` (~20-40s overhead cố định). Vì vậy `plan.md` phải hiển thị số bucket
và cảnh báo khi bucket explosion.

Riêng `deep-link` có đường rẻ hơn: `app.launchArguments += ["--xforge-deeplink", url]`
rồi để `XForgeTestSupport` route — chạy được **trong** một invocation, per-case.
→ Mặc định dùng launch-arg; `simctl openurl` chỉ dùng khi config bật
`state.deep_link_mode: "os"` (E2E thật, chấp nhận chi phí bucket).

#### (5) Navigation Graph — BFS là phần dễ, provenance mới là rủi ro

Tài liệu mô tả kỹ node/edge/BFS nhưng **không nói graph đến từ đâu**. BFS trên đồ
thị < 100 node là ~30 dòng code; phần khó là:

- **Nguồn**: ai viết graph? Nếu người dùng viết tay → nó sẽ stale ngay lập tức và
  BFS sẽ tự tin sinh ra đường đi sai.
- **Xung đột với nguyên tắc §6**: XForge cấm "invent requirements". Một edge suy
  diễn mà không có evidence chính là invent.
- **Stale detection**: `planning/hash.ts` phải hash graph vào `PlanInputs`, nếu
  không thì approval sẽ bind vào một plan sinh từ graph đã lỗi thời.

→ Graph phải có `provenance` + `confidence` per-edge như mọi artifact khác của
XForge, với 3 tier giống `analysis/features.ts` đã làm:

1. **explicit** — `.xforge/test/navigation.yaml` do người dùng khai báo (confidence 0.9)
2. **derived** — suy từ `feature.entry_points` trong Project Model (confidence 0.6)
3. **probed** — xác nhận bằng Live Probe, nâng lên confidence 1.0 (Phase 4)

Và BFS **chỉ được dùng edge có confidence ≥ ngưỡng config**; edge dưới ngưỡng →
`TestabilityIssue` chứ không âm thầm sinh path.

#### (6) LỖ HỔNG LỚN NHẤT — tài liệu không nêu: generator không sinh assertion

Đọc `generation/xcuitest.ts`:

```ts
// xcuitest.ts:87-89
for (const expected of testCase.expected_results) {
  bodyLines.push(`// EXPECT: ${expected}`); // ← chỉ là COMMENT
}
```

Và `renderStep()`: `tap`, `type`, `create-item`, `set-time`, `select-weekdays`,
`audit-accessibility` — **không có một `XCTAssert` nào**. Chỉ `open` có
`waitForExistence`.

Hệ quả: **mọi test XForge sinh ra hiện tại đều pass miễn là app không crash.**
Đây đúng là Exit-0 Trap mà mục D của tài liệu mô tả — nhưng nguyên nhân không phải
`xcodebuild` trả về 0 sai, mà là **XForge tự sinh test rỗng assertion**.

Tài liệu đề xuất chữa bằng Visual Agent + Claude Vision — tức là dùng LLM để bù
cho việc thiếu assertion xác định. Sai thứ tự ưu tiên: sửa generator là **P0, rẻ,
xác định, offline, test được bằng unit test**; Visual Agent là **P2, đắt, xác suất**.

---

## 3. Kế hoạch tích hợp (đã sắp xếp lại)

Ánh xạ với tài liệu nguồn: `A → Phase 3`, `B → Phase 1`, `C → Phase 2 + 4`, `D → Phase 0 + 5`.

| Phase | Tên                      | Mức | Rủi ro     | Cần Xcode?             | Phụ thuộc |
| :---- | :----------------------- | :-- | :--------- | :--------------------- | :-------- |
| **0** | Assertion Hardening      | S   | Thấp       | ❌                     | —         |
| **1** | State Buckets + simctl   | M   | Trung bình | ⚠️ chỉ khi `--execute` | 0         |
| **2** | Static Reconcile         | S–M | Thấp       | ❌                     | 0         |
| **3** | Navigation Graph + BFS   | L   | Trung bình | ❌                     | 0, 2      |
| **4** | Live Probe               | M   | Cao        | ✅                     | 1, 2, (3) |
| **5** | Visual Verification Loop | M   | Trung bình | ✅                     | 1         |

Nguyên tắc xuyên suốt: mọi phase phải giữ được **dry-run xanh không cần Xcode**
(như hiện tại), vì đó là thứ giữ cho 200 unit test chạy được ở mọi môi trường.

---

### Phase 0 — Assertion Hardening (P0, làm trước tiên)

**Mục tiêu**: test sinh ra phải fail được. Không có phase nào sau đây có ý nghĩa
nếu test luôn pass.

**Thay đổi**

1. `models/test-case.ts` — thêm model assertion có cấu trúc:

   ```ts
   export const Assertion = z.object({
     id: z.string().min(1),
     kind: z.enum([
       "exists",
       "not-exists",
       "label-equals",
       "label-contains",
       "count-equals",
       "enabled",
       "selected",
       "screen-is",
     ]),
     target: z.string().optional(),
     value: z.union([z.string(), z.number()]).optional(),
     /** Câu mô tả gốc từ expected_results, giữ để trace. */
     source_text: z.string().optional(),
   });
   ```

   `TestCase` thêm `assertions: z.array(Assertion).default([])`.
   **Giữ nguyên** `expected_results` (dùng cho báo cáo/LLM), không breaking.

2. `case-generator.ts` — mỗi `push()` sinh assertion tương ứng thay vì chỉ text.
   Ví dụ case happy-path hiện sinh expected `"${feature.name} screen is visible"`
   → thêm `{ kind: "exists", target: entryPointId }`.

3. `generation/xcuitest.ts`:
   - `renderAssertion()` mới: map `kind` → `XCTAssertTrue(...)` / `XCTAssertEqual(...)`.
   - `renderStep()`: `tap` → assert element tồn tại + `isHittable` trước khi tap.
   - `expected_results` **không có assertion tương ứng** → render thành
     `XCTFail("unverified expectation: …")` **hoặc** `XCTSkip(...)` tuỳ config
     `execution.strict_expectations` (mặc định: `XCTSkip` + đánh dấu case
     `confidence` thấp, để không phá vỡ dự án đang dùng). Tuyệt đối không render
     thành comment im lặng như hiện tại.

4. `planning/testability.ts` — issue mới `unverifiable-expectation` khi một case
   có `expected_results` mà không map được sang assertion nào.

**Test**: mở rộng `generation/xcuitest.test.ts` — assert rằng file sinh ra chứa
`XCTAssert`, và snapshot test cho từng `kind`.

**Ghi chú migration**: `TestCase` đổi shape → `planning/hash.ts` cho ra hash mới →
**mọi approval hiện có sẽ stale**. Đúng hành vi mong muốn (`verifyApproval` sẽ bắt),
nhưng phải nêu trong release note.

---

### Phase 1 — State Buckets + System-level simctl

**Mục tiêu**: đưa việc dựng trạng thái từ in-app mock lên OS-level, ở đúng mức
granularity mà kiến trúc cho phép.

**Thay đổi**

1. `models/test-case.ts` — `StateBucket` (schema như mục 2.4), gắn vào `TestCase`:

   ```ts
   state: StateBucket.optional(),
   ```

   `permissions` trong bucket chỉ nhận **13 service simctl hợp lệ** (enum đóng,
   Zod sẽ chặn `camera`/`notifications` ngay ở validate — fail fast, đúng chỗ).

2. `execution/simctl.ts` (file mới) — builder thuần cho command spec, cùng style
   với `simulator.ts` (trả `CommandSpec`, không tự execute):

   ```ts
   uninstallCommand(udid, bundleId)
   installCommand(udid, appPath)
   privacyCommand(udid, action, service, bundleId)
   openUrlCommand(udid, url)
   pushCommand(udid, bundleId, payloadPath)
   uiCommand(udid, "appearance" | "content_size", value)
   statusBarOverrideCommand(udid, …)
   ```

3. `execution/simulator.ts`:
   - `WorkerPhase` thêm: `"apply-state"` (giữa `install-app` và `run-tests`).
   - `testWithoutBuildingCommand()` thêm tham số `onlyTesting?: string[]` →
     sinh `-only-testing:<Target/Class/method>`.
   - `buildExecutionPlan()` trả thêm `setup: CommandSpec[]` cho mỗi worker.
   - Cần derive `.app` path: `${derivedDataPath}/Build/Products/${configuration}-iphonesimulator/${scheme}.app`
     — thêm vào `BuildCommandContext`, có thể override bằng config.

4. `planning/shard.ts` — sharding theo `(feature, bucketHash)`; thêm
   `workers.strategy: "state-bucket"` vào `config/schema.ts`.
   `SimulatorShard` thêm `state: StateBucket.optional()` + `case_ids` giữ nguyên.

5. `execution/orchestrator.ts` — chạy `worker.setup` trước `worker.test`; lỗi
   setup → `ENVIRONMENT_BLOCKED` cho toàn shard (không phải `FAIL_*`, đúng §4.4).

6. `models/plan.ts` — `PermissionScope` thêm `grantSystemPermissions`,
   `sendPushNotifications`, `openDeepLinks`; `render.ts` phải liệt kê chúng trong
   `permissions.md` (đây là leo thang quyền thật, phải hiện ra trước approval).

7. `config/schema.ts` — section mới:

   ```yaml
   state:
     enabled: true
     grant_permissions: false # opt-in, xem cảnh báo của simctl
     deep_link_mode: launch-arg # launch-arg | os
     fresh_install_for_ftu: true
     max_buckets_per_feature: 4 # chặn bucket explosion
   ```

8. `planning/testability.ts` — issue `permission-not-simctl-grantable` cho
   camera/notifications, kèm remediation "sinh `addUIInterruptionMonitor`".

9. `generation/xcuitest.ts` — sinh `addUIInterruptionMonitor` cho permission không
   grant được.

**Test**: toàn bộ qua `DryRunCommandRunner` — assert đúng chuỗi command spec cho
từng bucket. Không cần simulator thật.

**Rủi ro**: bucket explosion → thời gian chạy tăng phi tuyến. Giảm thiểu bằng
`max_buckets_per_feature` + hiển thị `estimated_duration` đã tính overhead
invocation trong `plan.md`.

---

### Phase 2 — Static Reconcile (offline, rẻ, giá trị cao)

**Mục tiêu**: bắt DEVIATION **trước khi build**, đúng như tài liệu mong muốn ở
mục C — nhưng bằng đường thực sự khả thi offline.

**Ý tưởng**: XForge Core đã có Swift parser (`packages/core/src/swift/parser.ts`).
Quét toàn bộ `.accessibilityIdentifier("…")` / `.accessibility(identifier:)` /
`accessibilityIdentifier = "…"` để dựng **inventory identifier thực tế có trong
source**, rồi đối chiếu với mọi locator mà `case-generator` định sinh ra.

**Thay đổi**

1. `packages/core/src/swift/parser.ts` — thêm `extractAccessibilityIdentifiers()`
   trả `{ identifier, file, line }[]`. Đặt ở Core vì đây là fact về source, không
   phải khái niệm QA (tuân thủ §2.2 reuse-never-fork).

2. `packages/test-core/src/planning/reconcile.ts` (file mới):

   ```ts
   reconcileLocators({ cases, inventory }): DeviationReport
   ```

   Thuần, deterministic, unit-test được hoàn toàn.

3. `apps/cli/src/commands/test/shared.ts` — nâng `probeEnvironment()` từ boolean
   `hasAccessibilityIdentifiers` (hiện chỉ `content.includes(...)`, quá thô) lên
   inventory đầy đủ. Đây là nâng cấp thuần chất lượng cho code đã có.

4. `planning/testability.ts` — issue `locator-not-found-in-source`, severity
   `critical`, `blocks_automation: true` khi mode `read-only`.

5. `plan.ts` (CLI) — nếu có deviation `critical` và config
   `planning.fail_on_deviation: true` → **từ chối sinh plan**, exit 1. Đây chính
   là điều tài liệu mong muốn, và ở đây nó thật sự pre-build.

**Giới hạn phải nói thẳng**: quét tĩnh không thấy được identifier sinh động
(`accessibilityIdentifier("row-\(index)")`) hay identifier đến từ design system
wrapper. → `reconcile.ts` phải phân biệt `MISSING` (chắc chắn thiếu) vs
`UNRESOLVABLE` (biểu thức động, không kết luận được) và **chỉ block trên `MISSING`**.
Phần `UNRESOLVABLE` là lý do Phase 4 tồn tại.

---

### Phase 3 — Navigation Graph + BFS

**Mục tiêu**: bỏ giả định đường đi tuyến tính; sinh navigation prefix ngắn nhất.

**Thay đổi**

1. `schemas/navigation-graph.schema.json` + `models/navigation.ts`:

   ```ts
   NavNode  = { id, anchor_identifier, feature?, provenance, confidence }
   NavEdge  = { from, to, action: "tap"|"swipe"|"open-url"|"back",
                target?, value?, provenance, confidence }
   NavGraph = { schema_version, nodes[], edges[], root }
   ```

2. `planning/navigation.ts` (file mới):
   - `loadNavigationGraph()` — đọc `.xforge/test/navigation.yaml` (explicit tier)
   - `deriveGraphFromModel()` — suy từ `feature.entry_points` (derived tier)
   - `mergeGraphs()` — explicit thắng derived
   - `shortestPath(graph, from, to, minConfidence)` — BFS, trả `TestStep[]`,
     trả `null` khi không có đường đi đủ tin cậy

3. `case-generator.ts` — thay `{ action: "open", target: … }` cứng bằng prefix từ
   BFS. Không tìm được đường → `TestabilityIssue` `no-navigation-path`, case
   `automation.blocked = true`. **Không bao giờ đoán bừa một path.**

4. `xcuitest.ts` — render prefix, thêm assert anchor tồn tại sau mỗi edge (nhờ
   Phase 0 đã có `renderAssertion`), để test fail đúng tại bước điều hướng sai
   chứ không fail mơ hồ ở cuối.

5. `planning/hash.ts` + `PlanInputs` — thêm `navigation_graph_hash`. Bắt buộc:
   không có nó thì approval không phản ánh đúng input.

6. `config/schema.ts`:

   ```yaml
   navigation:
     graph: .xforge/test/navigation.yaml
     min_edge_confidence: 0.6
     max_path_length: 6
   ```

7. CLI mới: `xforge test navigation` — in graph + kiểm tra reachability của mọi
   feature, để người dùng sửa graph mà không phải chạy plan.

**Rủi ro chính**: graph stale → BFS sinh path sai một cách tự tin. Giảm thiểu bằng
confidence gate + Phase 4 (probe xác nhận anchor thật) + hash binding.

---

### Phase 4 — Live Probe (Pre-flight A11y reconcile)

**Mục tiêu**: xác nhận thực tế cho phần Phase 2 không kết luận được (`UNRESOLVABLE`)
và nâng confidence cho navigation edge.

**Thay đổi**

1. `generation/probe.ts` (file mới) — sinh `XForgeProbeTests.swift`: duyệt
   `XCUIApplication().descendants(matching: .any)`, serialize
   `{identifier, label, type, frame, isEnabled, isHittable}` ra JSON, đính kèm
   `XCTAttachment`. Đi theo navigation graph (nếu có Phase 3) để probe nhiều màn.

2. `execution/orchestrator.ts` — pha `probe` mới, **sau build-once, trước test matrix**:

   ```
   build-once → [probe run: -only-testing:XForgeProbeTests] → reconcile
              → nếu DEVIATION critical: dừng, không chạy matrix
              → ngược lại: chạy shard matrix
   ```

   Gate bằng `execution.probe_before_run` (mặc định `false` cho tới khi ổn định).

3. `results/artifacts.ts` (file mới) — wrapper `xcrun xcresulttool export --type file`
   để lấy attachment ra khỏi `.xcresult`. **Phase 5 cũng cần module này** →
   xây một lần, dùng hai chỗ.

4. `planning/reconcile.ts` — tái dùng nguyên hàm reconcile của Phase 2, chỉ đổi
   nguồn inventory từ static sang probed. Thiết kế Phase 2 cần chừa sẵn interface này.

5. `analysis/accessibility.ts` — probe tree feed thẳng vào `auditAccessibility()`
   đã có sẵn. **Đây là phần thưởng miễn phí**: analyzer đã viết xong từ Phase 4 cũ
   nhưng chưa từng có dữ liệu thật để chạy.

6. Adapter tuỳ chọn cho `idb` — detect trong `test doctor`, dùng nếu có (nhanh hơn,
   không cần build probe target).

**Rủi ro cao nhất trong toàn kế hoạch**: cần app thật + simulator boot được, và
theo memory dự án thì fixture hiện tại là SPM library — **không verify end-to-end
được trong repo này**. Phải giữ toàn bộ logic thuần (parse tree / reconcile) sau
`CommandRunner` như các phase trước, và ghi rõ trong doc rằng đường `--execute`
chưa được kiểm chứng.

---

### Phase 5 — Visual Verification Loop

**Mục tiêu**: đóng vòng lặp visual — hiện `analysis/visual.ts` có `classifyVisual()`
hoàn chỉnh nhưng **chưa có gì sinh ra `VisualMetrics` cho nó**.

**Thay đổi**

1. `state/index.ts` — thêm layout artifacts vào `runDir`:

   ```
   qa-runs/<run-id>/artifacts/screens/<case-id>/<step-id>.png
   qa-runs/<run-id>/artifacts/diffs/…
   qa-runs/<run-id>/artifacts/probe/…
   ```

   (`RUN_FILES` hiện chỉ có 5 file phẳng, chưa có thư mục artifact.)

2. `results/artifacts.ts` (đã dựng ở Phase 4) — export `XCTAttachment` screenshot
   ra đúng path trên. Đây là Tác vụ 1 của Phase 4 trong tài liệu nguồn.

3. `analysis/visual-compare.ts` (file mới) — tính `VisualMetrics` thật:
   `pixelmatch` + `sharp` cho pixel diff, so với baseline
   `.xforge/test/baselines/` (model `VisualBaseline` đã có sẵn ở `models/bug.ts:72`).
   **Đây là dependency mới đầu tiên của repo** — cần cân nhắc: cả hai đều có native
   binding, sẽ ảnh hưởng cài đặt trên CI. Cân nhắc `optionalDependencies` +
   degrade gracefully sang `DESIGN_REFERENCE_MISSING`.

4. Trạng thái `DEVIATION` — **quyết định cần chốt**:
   - Phương án A: thêm `"DEVIATION"` vào `TestStatus` + vào `PRODUCT_FAILURE_STATUSES`.
     Rõ nghĩa, nhưng là **thay đổi enum lan toả**: `computeRunStats`, `triageBugs`,
     `computeCoverage`, `report.ts`, `schemas/test-result.schema.json` đều phải cập
     nhật; reader phiên bản cũ sẽ fail parse.
   - Phương án B: tái dùng `FAIL_VISUAL` + set `visual_verdict` (field đã có ở
     `models/result.ts:23`). Không breaking, nhưng mất khả năng phân biệt
     "pixel lệch" với "app khác spec".
   - **Khuyến nghị: A**, và nhân dịp đó bump `schema_version` của test-result lên 2.

5. Agent layer — `plugins/claude/agents/visual-analysis-agent.md` đã tồn tại.
   Nâng cấp thành: nhận đường dẫn `artifacts/screens/`, so với design map
   (`config/design-map.ts` đã có), trả verdict có cấu trúc. Giữ nguyên nguyên tắc
   §2: **LLM chỉ làm phần semantic; pixel diff và verdict threshold vẫn nằm ở CLI
   xác định**. Agent chỉ được phép nâng `PASS → DEVIATION`, không được hạ
   `FAIL → PASS`.

6. `results/triage.ts` + `reporting/report.ts` — nhận verdict, ghi vào bug report
   với evidence path đầy đủ.

---

## 4. Bảng quyết định cần chốt trước khi code

| #   | Quyết định                                                | Khuyến nghị                                                                       |
| :-- | :-------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| 1   | Sửa generator trước hay làm Navigation Graph trước?       | **Phase 0 trước**, không thương lượng                                             |
| 2   | `expected_results` chưa map assertion → fail hay skip?    | `XCTSkip` + confidence thấp (mặc định), `XCTFail` khi `strict_expectations: true` |
| 3   | `DEVIATION` là TestStatus mới hay tái dùng `FAIL_VISUAL`? | Status mới + bump `schema_version` test-result lên 2                              |
| 4   | Deep link: launch-arg hay `simctl openurl`?               | launch-arg mặc định; `os` là opt-in vì tốn thêm bucket                            |
| 5   | Thêm `sharp`/`pixelmatch` vào deps?                       | `optionalDependencies`, degrade sang `DESIGN_REFERENCE_MISSING` khi thiếu         |
| 6   | Live probe bật mặc định?                                  | Không — `probe_before_run: false` cho tới khi verify được trên app thật           |
| 7   | Navigation graph do người dùng viết tay?                  | Có, nhưng bắt buộc 3-tier provenance + confidence gate                            |

---

## 5. Đề xuất thứ tự triển khai

**Đợt 1 (giá trị cao nhất / rủi ro thấp nhất, không cần Xcode):**
Phase 0 → Phase 2. Sau đợt này XForge đã sinh được test **fail được** và bắt được
DEVIATION offline. Đây là bước nhảy lớn nhất về chất lượng thật, và verify được
100% bằng unit test trong repo này.

**Đợt 2:** Phase 1 (State Buckets). Cần refactor sharding — nên làm khi Phase 0
đã ổn định vì cả hai đều chạm `TestCase` shape.

**Đợt 3:** Phase 3 (Navigation Graph). Lớn nhất, nhưng độc lập và offline.

**Đợt 4:** Phase 4 + 5. Hoãn đến khi có app iOS thật để verify — hiện tại
fixture là SPM library nên không thể kiểm chứng trung thực.

**Gates mỗi phase** (theo memory dự án):

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

---

## 6. Những gì KHÔNG nên làm

- **Không** biến OS-level action thành `TestStep` tuỳ ý (mục 2.4) — sẽ sinh ra
  test không chạy được mà tận lúc `--execute` mới phát hiện, vi phạm §4.1.
- **Không** dùng LLM Vision để bù cho assertion thiếu (mục 2.6) — đắt, không
  deterministic, và che mất nguyên nhân gốc.
- **Không** để BFS sinh path từ edge suy diễn không có evidence — vi phạm §6.
- **Không** đặt Live Probe vào `xforge test plan` — plan phải giữ offline và
  deterministic (mục 2.3).
