#!/usr/bin/env bash
#
# Integration test for AURA metrics hooks.
# Simulates a full OpenSpec deliverable lifecycle and verifies metrics output.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/aura-hook.py"
VIEW="$SCRIPT_DIR/aura-view.py"

# Use a temp directory for AURA data to avoid polluting real metrics
export HOME="$(mktemp -d)"
AURA_DIR="$HOME/.aura"

# Set up a mock project directory with OpenSpec structure
PROJECT_DIR="$(mktemp -d)"
export CLAUDE_PROJECT_DIR="$PROJECT_DIR"

PASS=0
FAIL=0

pass() {
    PASS=$((PASS + 1))
    echo "  ✓ $1"
}

fail() {
    FAIL=$((FAIL + 1))
    echo "  ✗ $1"
}

check_file() {
    if [ -f "$1" ]; then
        pass "$2"
    else
        fail "$2 (file not found: $1)"
    fi
}

check_json_field() {
    local file="$1" field="$2" expected="$3" desc="$4"
    local actual
    actual=$(python3 -c "
import json, sys
with open('$file') as f:
    data = json.load(f)
keys = '$field'.split('.')
obj = data
for k in keys:
    if isinstance(obj, dict):
        obj = obj.get(k)
    else:
        obj = None
        break
print(obj)
" 2>/dev/null || echo "ERROR")
    if [ "$actual" = "$expected" ]; then
        pass "$desc"
    else
        fail "$desc (expected '$expected', got '$actual')"
    fi
}

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  AURA Metrics Hook — Integration Tests"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  AURA dir:    $AURA_DIR"
echo "  Project dir: $PROJECT_DIR"
echo ""

# ── Setup mock OpenSpec structure ────────────────────────────────────────────

echo "Setting up mock OpenSpec change..."
CHANGE_DIR="$PROJECT_DIR/openspec/changes/test-feature"
mkdir -p "$CHANGE_DIR/specs"

cat > "$CHANGE_DIR/proposal.md" << 'EOF'
# Test Feature Proposal
Add a test feature to the system.
EOF

cat > "$CHANGE_DIR/specs/delta-spec.md" << 'EOF'
# Delta Spec
## Requirements
- Requirement 1
- Requirement 2
- Requirement 3
EOF

cat > "$CHANGE_DIR/design.md" << 'EOF'
# Design
Simple implementation approach.
EOF

cat > "$CHANGE_DIR/tasks.md" << 'EOF'
# Tasks
- [x] Task 1: Setup foundation
- [x] Task 2: Implement core logic
- [ ] Task 3: Add tests
EOF

echo ""

# ── Test 1: SessionStart (no active deliverables) ───────────────────────────

echo "Test 1: SessionStart (no active deliverables)"
echo '{}' | python3 "$HOOK" SessionStart 2>/dev/null
pass "SessionStart runs without error"

# ── Test 2: UserPromptSubmit — /opsx:propose ────────────────────────────────

echo ""
echo "Test 2: /opsx:propose test-feature"
echo '{"prompt": "/opsx:propose test-feature"}' | python3 "$HOOK" UserPromptSubmit >/dev/null
check_file "$AURA_DIR/deliverables/test-feature.json" "State file created"
check_json_field "$AURA_DIR/deliverables/test-feature.json" "status" "propose" "Status is 'propose'"
check_json_field "$AURA_DIR/deliverables/test-feature.json" "change_id" "test-feature" "Change ID correct"

# ── Test 3: SessionStart (with active deliverable) ──────────────────────────

echo ""
echo "Test 3: SessionStart (with active deliverable)"
STDERR_OUT=$(echo '{}' | python3 "$HOOK" SessionStart 2>&1 >/dev/null)
if echo "$STDERR_OUT" | grep -q "test-feature"; then
    pass "SessionStart detects active deliverable"
else
    fail "SessionStart should report active deliverable on stderr"
fi

# ── Test 4: /opsx:ff (fast-forward through specs/design/tasks) ──────────────

echo ""
echo "Test 4: /opsx:ff test-feature"
echo '{"prompt": "/opsx:ff test-feature"}' | python3 "$HOOK" UserPromptSubmit >/dev/null
check_json_field "$AURA_DIR/deliverables/test-feature.json" "status" "tasks" "Status is 'tasks' after ff"

# Check that specs/design/tasks phases all have timestamps
python3 -c "
import json
with open('$AURA_DIR/deliverables/test-feature.json') as f:
    d = json.load(f)
for phase in ['specs', 'design', 'tasks']:
    p = d['phases'][phase]
    assert p is not None, f'{phase} is None'
    assert p['started_at'] is not None, f'{phase} started_at is None'
    assert p['completed_at'] is not None, f'{phase} completed_at is None'
print('OK')
" 2>/dev/null && pass "All ff phases have timestamps" || fail "FF phases missing timestamps"

# ── Test 5: /opsx:apply ─────────────────────────────────────────────────────

echo ""
echo "Test 5: /opsx:apply test-feature"
echo '{"prompt": "/opsx:apply test-feature"}' | python3 "$HOOK" UserPromptSubmit >/dev/null
check_json_field "$AURA_DIR/deliverables/test-feature.json" "status" "apply" "Status is 'apply'"

# ── Test 6: PostToolUse (simulate tool calls) ───────────────────────────────

echo ""
echo "Test 6: PostToolUse (simulating tool calls)"
for tool in Write Write Edit Bash Read Grep Glob Write; do
    echo "{\"tool_name\": \"$tool\"}" | python3 "$HOOK" PostToolUse >/dev/null
done
check_json_field "$AURA_DIR/deliverables/test-feature.json" "tool_calls.Write" "3" "Write count = 3"
check_json_field "$AURA_DIR/deliverables/test-feature.json" "tool_calls.Edit" "1" "Edit count = 1"
check_json_field "$AURA_DIR/deliverables/test-feature.json" "tool_calls.Bash" "1" "Bash count = 1"
check_json_field "$AURA_DIR/deliverables/test-feature.json" "tool_calls.total" "8" "Total count = 8"

# ── Test 7: Stop (during apply phase) ───────────────────────────────────────

echo ""
echo "Test 7: Stop (during apply phase)"
echo '{}' | python3 "$HOOK" Stop >/dev/null
check_json_field "$AURA_DIR/deliverables/test-feature.json" "apply_iterations" "1" "Apply iterations = 1"

# Second stop
echo '{}' | python3 "$HOOK" Stop >/dev/null
check_json_field "$AURA_DIR/deliverables/test-feature.json" "apply_iterations" "2" "Apply iterations = 2 after second stop"

# ── Test 8: /opsx:verify ────────────────────────────────────────────────────

echo ""
echo "Test 8: /opsx:verify test-feature"
echo '{"prompt": "/opsx:verify test-feature"}' | python3 "$HOOK" UserPromptSubmit >/dev/null
check_json_field "$AURA_DIR/deliverables/test-feature.json" "status" "verify" "Status is 'verify'"

# Stop during verify — should parse tasks.md
echo '{}' | python3 "$HOOK" Stop >/dev/null
check_json_field "$AURA_DIR/deliverables/test-feature.json" "spec_data.tasks_count" "3" "Tasks count = 3"
check_json_field "$AURA_DIR/deliverables/test-feature.json" "spec_data.tasks_completed" "2" "Tasks completed = 2"

# ── Test 9: /opsx:archive ───────────────────────────────────────────────────

echo ""
echo "Test 9: /opsx:archive test-feature"
echo '{"prompt": "/opsx:archive test-feature"}' | python3 "$HOOK" UserPromptSubmit >/dev/null
check_json_field "$AURA_DIR/deliverables/test-feature.json" "status" "completed" "Status is 'completed'"
check_file "$AURA_DIR/metrics/test-feature.json" "Metrics file created"

# Validate metrics content
echo ""
echo "Validating metrics output..."
check_json_field "$AURA_DIR/metrics/test-feature.json" "change_id" "test-feature" "Metrics change_id correct"
check_json_field "$AURA_DIR/metrics/test-feature.json" "metrics.deliverable_failed" "False" "Deliverable not failed"
check_json_field "$AURA_DIR/metrics/test-feature.json" "metrics.tasks_total" "3" "Metrics tasks_total = 3"
check_json_field "$AURA_DIR/metrics/test-feature.json" "metrics.tasks_completed" "2" "Metrics tasks_completed = 2"

# Check conformance scores exist and are reasonable
python3 -c "
import json
with open('$AURA_DIR/metrics/test-feature.json') as f:
    m = json.load(f)
c = m['metrics']['conformance']
assert 0 <= c['functional'] <= 1, f'functional out of range: {c[\"functional\"]}'
assert 0 <= c['correctness'] <= 1, f'correctness out of range: {c[\"correctness\"]}'
assert 0 <= c['constraints'] <= 1, f'constraints out of range: {c[\"constraints\"]}'
assert 0 <= c['overall'] <= 1, f'overall out of range: {c[\"overall\"]}'
# functional = 2/3 ≈ 0.6667
assert abs(c['functional'] - 2/3) < 0.01, f'functional should be ~0.667, got {c[\"functional\"]}'
# correctness = 1.0 (verify completed)
assert c['correctness'] == 1.0, f'correctness should be 1.0, got {c[\"correctness\"]}'
print('OK')
" 2>/dev/null && pass "Conformance scores are valid" || fail "Conformance scores invalid"

# ── Test 10: aura-view.py runs without error ────────────────────────────────

echo ""
echo "Test 10: aura-view.py"
python3 "$VIEW" >/dev/null 2>&1 && pass "aura-view.py runs without error" || fail "aura-view.py crashed"

# JSON mode
python3 "$VIEW" --json >/dev/null 2>&1 && pass "aura-view.py --json runs without error" || fail "aura-view.py --json crashed"

# Check JSON output contains expected data
python3 -c "
import json, subprocess, os
os.environ['HOME'] = '$HOME'
result = subprocess.run(['python3', '$VIEW', '--json'], capture_output=True, text=True)
data = json.loads(result.stdout)
assert 'completed_metrics' in data, 'missing completed_metrics'
assert len(data['completed_metrics']) == 1, f'expected 1 completed, got {len(data[\"completed_metrics\"])}'
print('OK')
" 2>/dev/null && pass "aura-view.py --json output is valid" || fail "aura-view.py --json output invalid"

# ── Test 11: UserPromptSubmit suppresses output ─────────────────────────────

echo ""
echo "Test 11: Hook output"
OUTPUT=$(echo '{"prompt": "hello world"}' | python3 "$HOOK" UserPromptSubmit 2>/dev/null)
if echo "$OUTPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('suppressOutput')==True" 2>/dev/null; then
    pass "Non-opsx prompts output suppressOutput: true"
else
    fail "Expected suppressOutput JSON"
fi

# ── Test 12: PostToolUse ignores non-apply phases ───────────────────────────

echo ""
echo "Test 12: PostToolUse outside apply phase"
# Create a new deliverable in propose phase
echo '{"prompt": "/opsx:propose test-feature-2"}' | python3 "$HOOK" UserPromptSubmit >/dev/null
echo '{"tool_name": "Write"}' | python3 "$HOOK" PostToolUse >/dev/null
check_json_field "$AURA_DIR/deliverables/test-feature-2.json" "tool_calls.total" "0" "Tool calls not incremented outside apply"

# ── Cleanup ──────────────────────────────────────────────────────────────────

rm -rf "$PROJECT_DIR" "$HOME"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    echo "  All $TOTAL tests passed ✓"
else
    echo "  $PASS/$TOTAL passed, $FAIL failed ✗"
fi
echo "═══════════════════════════════════════════════════════════════"
echo ""

exit "$FAIL"
