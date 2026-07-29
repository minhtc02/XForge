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

### Cài global — không bắt buộc

```bash
pnpm --filter @xforge/cli build
npm i -g ./apps/cli

# Hoặc:
# cd apps/cli
# npm link

xforge --help
```

## Các command chính

| Command                   | Mô tả                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| `xforge init`             | Detect loại dự án; tạo `.xforge/config.yaml`, thư mục state và thư mục output. |
| `xforge doctor`           | Kiểm tra môi trường và tính hợp lệ của config.                                 |
| `xforge docs`             | Tạo, lưu Canonical Project Model và tài liệu index.                            |
| `xforge docs sync`        | Sinh lại tài liệu cho các file đã thay đổi theo cơ chế incremental.            |
| `xforge docs check`       | Phát hiện documentation drift; trả exit code `1` nếu có drift.                 |
| `xforge inspect <target>` | In ra một phần cụ thể của Project Model.                                       |

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

Các command hiện có:

```text
/xforge:init
/xforge:docs
/xforge:sync
/xforge:doctor
/xforge:inspect
```

Plugin nằm trong `plugins/claude/`.

Các command của plugin gọi `xforge` CLI cho mọi tác vụ deterministic và sử dụng
các sub-agent sau cho semantic analysis:

```text
codebase-analyst
product-analyst
doc-writer
doc-reviewer
```

## XForge Test — QA tự động cho iOS

Module thứ hai đọc Canonical Project Model để lập kế hoạch và chạy quy trình QA
cho iOS.

Toàn bộ command surface đã được triển khai. Việc chạy trên Simulator mặc định ở
chế độ **dry-run**: XForge chỉ ghi lại chính xác kế hoạch build/test và tạo các
artifact của run.

Xcode chỉ được gọi khi thêm `--execute` trên máy macOS có app hỗ trợ UI test.

```bash
xforge test doctor
xforge test plan --feature alarm --level full
xforge test approve XFPLAN-20260729-001
xforge test run XFPLAN-20260729-001
xforge test status
xforge test report
xforge test bugs
xforge test clean [runs|cache]
```

### Cách hoạt động

`xforge test plan` tạo một test plan deterministic có liên kết evidence, bao gồm:

- QA Knowledge Model.
- Risk score.
- Testability issues.
- Simulator shard theo feature.
- Permission manifest.

Command này không chạy test.

`xforge test approve` gắn approval với hash chuẩn hóa của plan. Nếu plan bị sửa,
cũ hoặc không còn khớp, XForge sẽ từ chối chạy.

`xforge test run` kiểm tra lại hash trước khi thực thi và không hỏi thêm sau khi
approval hợp lệ.

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
