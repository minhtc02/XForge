# XForge

**Bộ biên dịch tri thức dự án & bộ công cụ phát triển AI.**

XForge đọc một dự án iOS/Swift hiện có — bao gồm source code, test, cấu hình,
PRD, artifact của Spec Kit và BMAD — sau đó biên dịch thành một
**Canonical Project Model**: mô hình có cấu trúc, có bằng chứng và có thể tái sử
dụng cho toàn bộ repository.

Từ mô hình này, XForge sinh tài liệu có khả năng phân biệt rõ:

- **As intended**: sản phẩm được mô tả như thế nào trong PRD/spec.
- **As built**: source code và test hiện tại đang triển khai như thế nào.
- **Project rules**: các nguyên tắc bắt buộc của dự án như constitution,
  conventions hoặc coding rules.

Mỗi nhận định quan trọng trong tài liệu đều có source reference đi kèm.

> Trạng thái: **v0.1 — Phase 1 (Foundation)**. Phần lõi deterministic gồm scan,
> detect, config, Project Model, secret redaction và incremental drift đã được
> triển khai và kiểm thử. Phần mô tả chuyên sâu theo từng tính năng được tạo bởi
> lớp LLM thông qua Claude Code plugin trên nền tảng này.

## Cấu trúc repository

```text
xforge/
├── apps/cli/            # xforge CLI (Commander) — toàn bộ command deterministic
├── packages/
│   ├── shared/          # error types, structured logger, Result
│   └── core/            # Project Model, config, redaction, discovery, state
├── plugins/claude/      # Claude Code plugin (commands/skills/agents/bin)
├── schemas/             # JSON Schema cho config, project model và report
├── templates/           # template tài liệu
├── test-fixtures/       # dự án iOS mẫu dùng cho smoke test
└── docs/
```

Logic deterministic nằm trong `packages/core` và `apps/cli`. Claude plugin
**gọi CLI** và chỉ bổ sung semantic analysis; plugin không sao chép lại business
logic của core.

## Yêu cầu môi trường

- Node.js >= 20, hiện được phát triển trên Node 26.
- pnpm 9 thông qua `corepack`.

## Phát triển trên máy local

```bash
# 1. Kích hoạt pnpm; Corepack được cài kèm Node
corepack prepare pnpm@9.15.0 --activate

# Nếu Corepack không thể tạo symlink vào /usr/local/bin, tạo shim:
#   printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > ~/.local/bin/pnpm
#   chmod +x ~/.local/bin/pnpm
#   export PATH="$HOME/.local/bin:$PATH"

# 2. Cài dependencies
pnpm install

# 3. Build toàn bộ packages và CLI
pnpm build

# 4. Chạy các quality gate
pnpm typecheck
pnpm lint
pnpm test

# 5. Chạy CLI mà không cần cài global
node apps/cli/dist/index.js --help

# Hoặc chạy trực tiếp từ TypeScript trong quá trình phát triển
pnpm --filter @xforge/cli dev -- --help
```

### Chạy thử với fixture có sẵn

```bash
pnpm build
node apps/cli/dist/index.js --cwd test-fixtures/ios-swiftui init
node apps/cli/dist/index.js --cwd test-fixtures/ios-swiftui doctor
node apps/cli/dist/index.js --cwd test-fixtures/ios-swiftui docs
node apps/cli/dist/index.js --cwd test-fixtures/ios-swiftui inspect project --json
```

### Cài global — được khuyến nghị để sử dụng

```bash
pnpm --filter @xforge/cli build
npm i -g ./apps/cli

# Hoặc:
# cd apps/cli
# npm link

xforge --help
```

## Các command chính

| Command                   | Mô tả                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `xforge init`             | Detect loại dự án; tạo `.xforge/config.yaml`, thư mục state, `docs/project/` (nguồn) và `docs/xforge/` (output). |
| `xforge doctor`           | Kiểm tra môi trường và tính hợp lệ của config.                                                                   |
| `xforge docs`             | Tạo, lưu Canonical Project Model và cây tài liệu. Hỏi xác nhận nguồn tài liệu trước khi sinh.                    |
| `xforge docs sync`        | Sinh lại tài liệu cho các file đã thay đổi theo cơ chế incremental.                                              |
| `xforge docs check`       | Phát hiện documentation drift; trả exit code `1` nếu có drift.                                                   |
| `xforge upgrade`          | Nâng dự án đã init bằng bản XForge cũ lên bản hiện tại; chỉ thêm, không bao giờ ghi đè.                          |
| `xforge inspect <target>` | In ra một phần cụ thể của Project Model.                                                                         |

Nhóm `xforge test <sub>` và `xforge dev <sub>` được mô tả ở mục
[XForge Test](#xforge-test--qa-tự-động-cho-ios) và
[XForge Dev](#xforge-dev--phát-triển-theo-spec).

## Tích hợp XForge vào một dự án iOS có sẵn

Các mục bên dưới mô tả từng phần; đây là toàn bộ đường đi, theo thứ tự. Mỗi
bước đều báo lỗi rõ ràng nếu bước trước chưa xong, nên không thể vô tình bỏ qua.

```bash
cd /path/to/your-ios-app

# 0. Đặt PRD/spec của bạn vào docs/project/ (hoặc trỏ sources.project_docs tới
#    nơi bạn đang để tài liệu). Nếu docs/project/ đã có sẵn thì được dùng luôn.

xforge init          # detect dự án Xcode; ghi config + cả hai cây tài liệu
xforge docs          # biên dịch Canonical Project Model — bắt buộc trước khi QA
xforge test doctor   # kiểm tra môi trường; phải xanh hết mới lập plan được
xforge test plan --level smoke
xforge test run <plan-id>             # dry run: chỉ ghi lại lệnh, không gọi Xcode
xforge test run <plan-id> --execute   # chạy thật
```

Có hai thứ cần kiểm tra trong output của `init` trước khi đi tiếp. Nếu
**scheme** hoặc **UI test target** vẫn còn là `auto` thì `--execute` sẽ fail —
nguyên nhân thường gặp là scheme chưa được shared (trong Xcode: Product → Scheme
→ Manage Schemes → tick "Shared"). Và `xforge docs` không phải bước tùy chọn
trước khi QA: test plan được suy ra từ feature và requirement trong Project Model.

Muốn chạy qua Claude Code? Xem mục [Claude Code plugin](#claude-code-plugin) —
cùng trình tự, cộng thêm `/xforge:test-design` vốn với tới được Figma trong khi
CLI thì không.

## Hai cây tài liệu

`xforge init` tạo cả hai, và việc tách bạch chúng chính là điểm mấu chốt:

| Thư mục         | Chủ sở hữu | Vai trò                                                                             |
| --------------- | ---------- | ----------------------------------------------------------------------------------- |
| `docs/project/` | **bạn**    | PRD, spec, tài liệu thiết kế của bạn. XForge chỉ đọc, không bao giờ ghi vào đây.    |
| `docs/xforge/`  | XForge     | Tài liệu được sinh ra. Mỗi lần chạy đều ghi đè; chỉ sửa tay bên trong manual block. |

Nếu `docs/project/` đã tồn tại sẵn, XForge dùng luôn và không đụng vào nội dung
bên trong — dự án đang để spec ở đó không cần migrate gì cả.

Hai cây này bắt buộc phải tách nhau. Nếu XForge ghi vào chính thư mục nó đọc làm
nguồn sự thật, lần chạy sau sẽ đọc văn bản do chính nó sinh ra thành requirement
rồi báo cáo là đã đáp ứng 100% — một mô hình tự đồng ý với chính mình.
`xforge doctor` sẽ báo fail nếu hai cây chồng lên nhau.

`xforge docs` mặc định lấy **tài liệu dự án của bạn** làm nguồn: một yêu cầu viết
trong `docs/project/` là _ý định_, và phần code được đối chiếu với nó. Source code
vẫn được quét để làm bằng chứng cho mọi khẳng định. Vì lựa chọn này thay đổi kết
quả đáng kể, `docs` luôn hỏi xác nhận trước khi sinh:

```
Which source should this documentation be built from?

  ›  1. Project documents  — docs/project/**/*.md lead; code supplies evidence
     2. Source code  — the repository leads; project documents are secondary
```

Bỏ qua câu hỏi bằng flag — đây là cách CI và agent nên dùng:

```bash
xforge docs --from-docs    # tài liệu dự án dẫn dắt (mặc định)
xforge docs --from-code    # repo dẫn dắt; dùng khi tài liệu đã lệch so với code
xforge docs --yes          # chấp nhận giá trị đã cấu hình, không hỏi
```

Câu hỏi chỉ xuất hiện trên terminal thật. Khi chạy với `--json`, qua pipe, hoặc
trong CI thì giá trị `generation.docs_source` trong config được áp dụng im lặng.
Sửa giá trị đó trong `.xforge/config.yaml` để đổi mặc định vĩnh viễn.

Tất cả command đều hỗ trợ:

```text
--json
```

để trả output có thể đọc bằng máy, và:

```text
--cwd <dir>
```

để chạy trên một thư mục khác.

Global flags:

```text
--verbose
--quiet
```

Exit codes:

```text
0 = thành công
1 = lỗi nghiệp vụ hoặc validation, ví dụ drift
2 = lỗi config hoặc runtime
```

## Claude Code plugin

XForge có thể dùng hoàn toàn từ Claude Code — và đây là cách được thiết kế để
dùng, bởi phần việc semantic (văn xuôi, phán đoán requirement, Figma) vốn thuộc
về LLM, còn plugin là thứ nối hai nửa đó lại.

```text
/xforge:init          /xforge:docs         /xforge:sync
/xforge:doctor        /xforge:inspect
/xforge:test-doctor   /xforge:test-plan    /xforge:test-review
/xforge:test-a11y     /xforge:test-design  /xforge:test-run
/xforge:test-status   /xforge:test-report
/xforge:dev-doctor    /xforge:dev-plan     /xforge:dev-run       (+12 command dev khác)
```

Plugin nằm trong `plugins/claude/`: 29 command, 22 agent và 5 skill. Các command
của plugin gọi `xforge` CLI cho mọi tác vụ deterministic và dùng sub-agent cho
semantic analysis:

```text
codebase-analyst
product-analyst
doc-writer
doc-reviewer
```

cộng với 8 agent QA và 9 agent dev.

### Cài đặt Plugin

XForge là monorepo nên khi cài từ GitHub phải dùng cờ `--sparse`:

```bash
claude plugin marketplace add https://github.com/YourOrg/XForce --sparse plugins/claude
/plugin install xforge
```

Khi đang phát triển cục bộ (chưa publish):

```bash
cd /path/to/your-ios-app
claude --plugin-dir /path/to/xforge/plugins/claude
```

Bạn **không cần** cài `xforge` global: `plugins/claude/bin/xforge` ưu tiên
`xforge` trên PATH, không có thì fallback về bản build trong monorepo — chỉ cần
chạy `pnpm build` một lần.

### Chạy một dự án từ Claude Code

Mở Claude Code **tại thư mục dự án iOS của bạn**, sau khi đã đặt PRD và spec vào
`docs/project/`:

```text
/xforge:init          # detect dự án, tạo cả hai cây tài liệu
/xforge:docs          # biên dịch Canonical Project Model — bắt buộc trước khi QA
/xforge:test-doctor   # kiểm tra môi trường
/xforge:test-plan alarm
/xforge:test-review XFPLAN-…    # khi plan báo có màn hình không ai tham chiếu
/xforge:test-design XFPLAN-…    # tùy chọn: điền tham chiếu Figma qua MCP
/xforge:test-run XFPLAN-…
```

Khi chạy qua Claude Code, `/xforge:docs` truyền `--yes` nên **không hiện câu hỏi
chọn nguồn** — nó áp dụng giá trị `generation.docs_source` trong config. Muốn
dùng nguồn còn lại thì nói rõ ("sinh tài liệu từ source code"), agent sẽ thêm
`--from-code`.

**`/xforge:test-design` chỉ hoạt động qua plugin.** CLI là một Node process
thuần, không với tới được Figma MCP server, nhưng Claude thì có: agent fetch
từng node rồi ghi ra file snapshot, CLI đọc file đó sau. Nhờ vậy credential
không đi qua CLI và việc so sánh vẫn tái lập được từ file.

## XForge Test — QA tự động cho iOS

Module thứ hai đọc Canonical Project Model để lập kế hoạch và chạy quy trình QA
cho iOS.

Toàn bộ command surface đã được triển khai. Việc chạy trên Simulator mặc định ở
chế độ **dry-run**: XForge chỉ ghi lại chính xác kế hoạch build/test và tạo các
artifact của run.

Xcode chỉ được gọi khi thêm `--execute` trên máy macOS có app hỗ trợ UI test.

```bash
xforge test doctor
xforge test setup
xforge test plan --feature alarm --level smoke
xforge test review XFPLAN-20260729-001      # giải quyết câu hỏi dead code
xforge test a11y XFPLAN-20260729-001        # đề xuất accessibility identifier còn thiếu
xforge test run XFPLAN-20260729-001
xforge test status
xforge test report
xforge test bugs
xforge test clean [runs|cache]
```

### Cách hoạt động

`xforge test plan` là **một pipeline, không phải một bước đơn lẻ**. Một lần gọi
sẽ chạy preflight môi trường, scaffold `navigation.yaml` nếu dự án chưa có, dựng
plan, sinh source XCUITest, chép chúng vào Xcode target và approve plan. Tắt
từng bước bằng `--no-doctor`, `--no-navigation`, `--no-generate`, `--no-xcode`,
`--no-approve`. Với dự án chưa từng test, nên bắt đầu bằng `--level smoke`.

Bản thân plan là deterministic và có liên kết evidence, bao gồm:

- QA Knowledge Model.
- Risk score.
- Testability issues.
- Simulator shard theo feature.
- Permission manifest.

Bước lập plan không chạy test.

Approval được gắn với hash chuẩn hóa của plan. Nếu plan bị sửa hoặc đã cũ,
XForge từ chối chạy — approval trở nên stale sau khi re-plan là hành vi đúng,
không phải lỗi. `xforge test run` kiểm tra lại hash trước khi thực thi và không
hỏi thêm gì sau khi approval hợp lệ.

### Làm cho dự án test được

XCUITest điều khiển app từ một **process riêng** thông qua accessibility API, và
iOS chỉ cấp quyền đó cho bundle có product type
`com.apple.product-type.bundle.ui-testing`. Không có cách nào chạy loại test này
từ app target — đó là ranh giới của hệ điều hành chứ không phải quy ước của
Xcode — nên dự án chưa có UI test target thì không QA được, và `test doctor` sẽ
báo blocker.

`xforge test setup` tạo target đó, kèm `Info.plist` của bundle và một shared
scheme (`xcodebuild -scheme` không nhìn thấy scheme nằm trong `xcuserdata`):

```bash
xforge test setup --dry-run   # xem trước sẽ thay đổi gì
xforge test setup             # làm thật
```

Lệnh này sửa `project.pbxproj` — file mà một lần ghi sai sẽ không báo lỗi ồn ào,
nó chỉ khiến Xcode không mở được project. Nên thao tác được backup trước, verify
cấu trúc cả trước lẫn sau khi ghi, và khôi phục từ backup nếu có bất thường. Nó
cũng idempotent: dự án đã có UI test target thì được để yên. Kiểm tra
`git diff -- '*.pbxproj'` trước khi commit.

Lệnh này cũng đặt `XForgeTestSupport.swift` vào app target và chèn một lời gọi
`XForgeTestSupport.configure()` vào `@main` App — đây là chỗ duy nhất XForge sửa
product source. Chỉ có file thì không có tác dụng gì: phải có call site thì
deterministic clock, network mock và seed data mới chạy được, nên "không sửa code
sản phẩm" ở đây không có nghĩa là "ít xâm phạm hơn", mà là "tính năng không hoạt
động". Sửa đúng bốn dòng, nằm trong `#if DEBUG` (bắt buộc: callee chỉ tồn tại ở
DEBUG, gọi không guard sẽ không build được bản Release), và không làm gì nếu
thiếu launch argument `--xforge-test`. Gặp hình dạng nó không nhận ra — `@main`
kiểu UIKit, initializer tùy biến, hai type `@main` — nó báo lý do và không sửa gì;
thân các hook đều là stub rỗng nên test vẫn chạy được mà không cần nó.

### Accessibility identifier mà plan cần

XCUITest tìm element qua `accessibilityIdentifier`. Một locator mà plan tìm nhưng
không view nào khai báo sẽ khiến mọi case dùng nó fail vì timeout — và triage đọc
timeout thành bug sản phẩm, nên báo cáo sẽ quy lỗi cho app vì một khiếm khuyết của
test.

```bash
xforge test a11y XFPLAN-20260729-001           # một đề xuất cho mỗi locator
xforge test a11y XFPLAN-20260729-001 --apply   # chỉ ghi những entry đã duyệt
```

Mọi entry mặc định `approved: false`, và đúng cái cổng đó mới là tính năng.
Identifier thiếu thì fail ồn ào và được sửa ngay. Identifier đặt **sai element**
thì không: gắn lên `VStack` thay vì `Button` bên trong, test sẽ tìm thấy element,
tap, pass — mà không chạm gì tới thứ cần kiểm, âm thầm như thế suốt thời gian test
còn tồn tại. Nên container không bao giờ được đề xuất, hai ứng viên ngang nhau thì
không đề xuất gì cả (hai element đều hợp lý là một thông tin; biến nó thành một cú
tung xu đội lốt giá trị mặc định là bỏ mất thông tin đó), và mỗi đề xuất đều nói
rõ căn cứ. `/xforge:test-a11y` làm phần cần phán đoán: đọc view để quyết định
locator thuộc về element nào.

Khi apply, lệnh đọc lại dòng anchor và từ chối nếu file đã thay đổi, khớp indent
theo đúng modifier chain sẵn có của element, rồi parse lại để chắc chắn đọc được
identifier vừa ghi — mọi trường hợp khác đều để file nguyên vẹn. Modifier **không**
bọc `#if DEBUG`, có chủ ý: identifier không đổi hành vi, còn bỏ nó khỏi bản Release
sẽ khiến test chạy máy local thì pass nhưng timeout trên đúng bản build mà
TestFlight dùng. Sau khi apply, chạy lại `xforge docs` rồi re-plan để model thấy
chúng.

### Những thứ âm thầm làm mất coverage

Có ba output quan trọng hơn cả số lượng test case, vì mỗi thứ đều lấy đi test mà
không làm fail gì cả:

- **Accessibility identifier là điều kiện tiên quyết.** Test sinh ra định vị
  element qua a11y id, không bao giờ tap theo tọa độ. `plan` đối chiếu tĩnh mọi
  locator với source (offline) và báo `reconcile.missing` — id không có trong
  source sẽ chặn case đó. Phải gắn identifier cho app trước.
- **Feature không tới được sẽ sinh ra 0 case.** Feature mà không có đường điều
  hướng đủ tin cậy sẽ được báo cáo, chứ không bị đoán bừa. File
  `navigation.yaml` scaffold ra khởi tạo mọi cạnh ở mức `derived` (confidence
  0.6), nên cần review và nâng những cạnh đã xác nhận lên `explicit`. Kiểm tra
  bằng `xforge test navigation`.
- **`testability-report.md` liệt kê thứ sẽ chen ngang lúc chạy.** `simctl` thực
  sự không cấp trước được quyền camera và notification, nên các alert đó sẽ hiện
  giữa run trừ khi xử lý bằng `addUIInterruptionMonitor` hoặc test-support hook.

Khi `plan` báo `xcodeIntegration.method: none` tức là source chưa được wire vào
project — cần thêm `XForgeUITests.swift` vào UI test target và
`XForgeTestSupport.swift` vào app target, rồi gọi `XForgeTestSupport.configure()`
lúc app khởi động. File `README.md` nằm cạnh source đã sinh có hướng dẫn chính
xác. Chạy `--execute` trước khi làm việc này sẽ build ra một app không chứa test
nào của XForge.

### Dead code và vòng review

Bộ lập plan suy luận từ khai báo, nên một màn hình đã bị bỏ và một màn hình đang
sống trông giống hệt nhau với nó. Nếu để nguyên, nó sẽ sinh ra một plan rất tự
tin nhắm vào màn hình không code path nào present — mọi case đều pass, còn màn
hình thật sự đang ship thì không được test lần nào.

XForge giờ đối chiếu chéo mọi screen type với phần source còn lại. Nếu plan điều
hướng tới một anchor được khai báo trong file mà các screen của nó không ai tham
chiếu, `plan` sẽ **không tự approve** và nói rõ:

```
NOT approved — nothing in the app refers to: CategoryDetailScreen.
```

Câu hỏi đó không thể trả lời bằng phân tích tĩnh — phép kiểm tra thuần từ vựng,
không thấy được reflection, storyboard instantiation hay registration theo string
key. Nó cần người đọc được call site, và đó là việc của `xforge test review`:

```bash
xforge test review <plan-id>            # template + các câu hỏi còn bỏ ngỏ
# điều tra, điền verdict
xforge test review <plan-id> --apply    # merge vào plan một cách deterministic
xforge test review <plan-id> --apply --approve   # …rồi sinh lại source và approve
```

Trong Claude Code, `/xforge:test-review <plan-id>` tự làm phần điều tra: grep
từng type, tìm ra màn hình app thực sự present, rồi ghi verdict ngược lại. Mỗi
verdict là `keep`, `drop`, `retarget` hoặc `revise`; bất cứ thứ gì khác `keep`
đều **bắt buộc có rationale và ít nhất một evidence** — schema từ chối một thay
đổi không ai giải thích được. CLI thực hiện việc merge nên agent không bao giờ
tự ghi `plan.json`: suite, shard và stats luôn nhất quán, mọi verdict được lưu
trong plan cho người đọc sau, và việc re-hash làm mọi approval cũ mất hiệu lực.

Một review làm rỗng toàn bộ case sẽ bị từ chối. Đó là thất bại của khâu lập plan
chứ không phải một review: hãy sửa đầu vào rồi plan lại, thay vì approve một plan
rỗng luôn pass.

`--approve` khép kín vòng lặp: nó sinh lại source XCUITest (bắt buộc sau khi
retarget — file Swift cũ vẫn trỏ vào anchor cũ) rồi approve, nên toàn bộ chặng
từ "planner làm sai" tới "sẵn sàng chạy" gói trong một lệnh. Nhưng nó **chỉ
approve nếu review đã trả lời hết những câu hỏi vốn khiến plan bị giữ lại.** Một
case bị đánh dấu mà để nguyên `keep` trống là im lặng chứ không phải câu trả lời,
và sẽ bị từ chối kèm tên case:

```
NOT approved — the review did not settle every open question:
  - CategoryDetailScreen: 1 case(s) (TC-DISCOVERY-001) were left at `keep`
    with no rationale or evidence, so the dead-code question was never answered.
```

Cửa chặn đó chính là giá trị của tính năng, không phải vật cản. Tự approve một
review chẳng điều tra gì sẽ biến "chưa biết cái này có test dead code không"
thành "đã duyệt" — tệ hơn hẳn vấn đề ban đầu, vì nghi ngờ trở nên vô hình. Một
`keep` **có kèm** rationale và evidence ("được present qua `NavigationLink` mà
phép quét từ vựng không thấy") là câu trả lời thật và sẽ đi qua — trường hợp này
rất hay gặp, vì phép kiểm tra vốn không thấy reflection và storyboard.

Quy trình run:

```text
Build một lần
→ Chia test theo feature
→ Chạy từng shard
→ Continue on failure
→ Phân loại lỗi
→ Deduplicate bug
→ Sinh QA report
```

Các lỗi infrastructure hoặc environment không được báo cáo như product bug.

Artifact được lưu tại:

```text
qa-runs/<run-id>/
```

Ví dụ:

```text
summary.md
summary.json
test-results.json
bugs.json
coverage.md
```

### Kiến trúc nội bộ

`packages/test-core` chứa:

- QA model.
- Test planning.
- Risk calculation.
- Testability analysis.
- Plan hashing.
- Simulator sharding.
- XCUITest generation.
- XForgeTestSupport generation.
- `xcresult` parsing.
- Failure classification.
- Bug deduplication.
- Visual analysis.
- Accessibility analysis.
- Performance analysis.
- Test orchestrator.

Orchestrator nằm sau abstraction `CommandRunner`, hỗ trợ cả dry-run và
spawn-backed execution.

Config của XForge Test:

```text
.xforge/test/config.yaml
```

Figma adapter dạng file-backed sử dụng:

```text
design-map.yaml
```

và fixture để việc lập kế hoạch có thể chạy offline.

### Claude commands cho XForge Test

```text
/xforge:test-doctor
/xforge:test-plan
/xforge:test-review
/xforge:test-a11y
/xforge:test-design
/xforge:test-run
/xforge:test-status
/xforge:test-report
```

Các QA agent:

```text
qa-lead
environment-agent
test-case-author
feature-test-agent
visual-analysis-agent
performance-analysis-agent
accessibility-analysis-agent
bug-triage-agent
```

## XForge Dev — phát triển theo spec

Module thứ ba triển khai tính năng theo spec trong các Git worktree độc lập.

Toàn bộ command surface đã được triển khai, gồm:

- Planning.
- Execution.
- Integration.
- Optional quality gates.
- Staged Spec journal.
- Docs sync.
- Auto mode.

Một run thật sẽ tạo worktree và delivery package, nhưng deterministic orchestrator
không tự viết product code. Các Claude agent có scope rõ ràng sẽ thực hiện code
bên trong worktree được phân công.

Nguyên tắc quan trọng nhất:

> XForge Dev mặc định chỉ triển khai code.

Các trạng thái sau mặc định là `NOT_REQUESTED`:

```text
build
test
ui verification
performance verification
```

Docs sync mặc định là `NOT_REQUIRED`.

Không tác vụ nào trong số này được chạy nếu người dùng chưa yêu cầu rõ ràng.

```bash
xforge dev doctor

xforge dev plan --feature alarm   --request "change maximum alarms to 20"

xforge dev run XFDEVPLAN-20260729-001 --dry-run
xforge dev run XFDEVPLAN-20260729-001 --execute

xforge dev status
xforge dev report
xforge dev review

xforge dev accept <run-id>

xforge dev sync-docs <plan-id>
xforge dev dismiss-spec <plan-id>

xforge dev build <plan-id>
xforge dev test <plan-id>
xforge dev ui-check <plan-id>
xforge dev performance <plan-id>

xforge dev auto --feature alarm
xforge dev clean [runs|worktrees]
```

### Effective Spec

`xforge dev plan` tạo:

```text
Effective Spec
=
Canonical docs
+ User overrides
+ Approved plan
```

Docs là nguồn sự thật mặc định.

Yêu cầu trực tiếp của người dùng có thể override docs cho run hiện tại. Mọi điểm
khác biệt đều được ghi vào **Staged Spec**.

Staged Spec là nhật ký thay đổi, không phải code gate.

Điều này có nghĩa:

```text
Code có thể được hoàn thành và chấp nhận
dù docs chưa được cập nhật.
```

Docs chỉ được thay đổi khi người dùng chạy:

```bash
xforge dev sync-docs <plan-id>
```

Hoặc bỏ qua bằng:

```bash
xforge dev dismiss-spec <plan-id>
```

### Worktree isolation

Plan tạo các implementation group theo dependency và file scope.

Mỗi group chạy trên branch dạng:

```text
xforge/dev/<change-id>/<group>
```

và worktree nằm dưới:

```text
.xforge/worktrees/
```

Luôn có một integration worktree riêng.

XForge Dev bảo đảm:

- Không ghi trực tiếp vào main checkout.
- Không tự merge vào main.
- Không force-push.
- Không xóa worktree không do XForge tạo.
- Validate path traversal.
- Validate branch name.
- Validate main protection.
- Validate worktree lifecycle.

### Dry-run và execute

Mặc định:

```bash
xforge dev run <plan-id> --dry-run
```

sẽ:

- Validate base branch.
- Validate worktree path.
- Hiển thị branch dự kiến.
- Hiển thị file scope.
- Hiển thị permission.
- Không tạo worktree.
- Không sửa source.

Chỉ khi chạy:

```bash
xforge dev run <plan-id> --execute
```

deterministic orchestrator mới:

```text
Tạo worktree
→ Schedule implementation groups
→ Static review
→ Integration
→ Tạo delivery package
```

### Auto mode

```bash
xforge dev auto --feature alarm
```

Auto mode không hỏi giữa run nếu plan nằm trong policy đã được phê duyệt trước.

Nếu plan vượt quá phạm vi được phép, ví dụ:

- Thêm dependency.
- Database migration.
- Public API change.
- Entitlement change.
- Signing change.
- CI change.

XForge từ chối auto mode và chuyển về plan-first.

### Kiến trúc nội bộ

`packages/dev-core` chứa:

- Dev model.
- Effective Spec resolver.
- User override detection.
- Staged Spec journal.
- Source-doc hash drift detection.
- Docs sync và dismiss.
- Worktree planner.
- Worktree safety validation.
- Worktree manager.
- Impact analyzer.
- Plan builder.
- Plan hashing.
- Dependency-aware scheduler.
- Integration merge planner.
- Deterministic static review.
- Delivery package renderer.
- Optional quality-gate specs.
- Auto-mode policy.
- Figma adapter dạng file-backed.
- Reference-image adapter dạng file-backed.

Config:

```text
.xforge/dev/config.yaml
```

Một trạng thái thành công hợp lệ:

```yaml
development: CODE_COMPLETED
build: NOT_REQUESTED
test: NOT_REQUESTED
ui_verification: NOT_REQUESTED
performance: NOT_REQUESTED
documentation_sync: NOT_SYNCED
```

### Claude commands cho XForge Dev

```text
/xforge:dev-doctor
/xforge:dev-plan
/xforge:dev-run
/xforge:dev-auto
/xforge:dev-status
/xforge:dev-report
/xforge:dev-review
/xforge:dev-accept
/xforge:dev-reject
/xforge:dev-build
/xforge:dev-test
/xforge:dev-ui-check
/xforge:dev-performance
/xforge:dev-inspect-spec
/xforge:dev-sync-docs
/xforge:dev-dismiss-spec
/xforge:dev-clean
```

Các Dev agent:

```text
dev-lead
spec-analyst
architecture-analyst
impact-analyst
senior-ios-engineer
senior-ui-engineer
persistence-engineer
integration-engineer
static-code-reviewer
spec-change-recorder
```

## Bảo mật và quyền riêng tư

XForge không đọc, đưa vào prompt, ghi log hoặc nhúng nội dung của các file nhạy
cảm như:

```text
.env
*.pem
*.p12
*.mobileprovision
GoogleService-Info.plist
Secrets.swift
credentials
private keys
```

Redaction layer tự động làm sạch các pattern nhạy cảm khỏi text trước khi text
được đưa vào:

- Prompt.
- Log.
- Evidence.
- Docs.
- Report.
- Bug artifact.

Các pattern được xử lý bao gồm:

- API key.
- Bearer token.
- JWT.
- Private key block.
- Credential string.

Mã nguồn nằm tại:

```text
packages/core/src/redaction/
```

## Giấy phép

MIT
