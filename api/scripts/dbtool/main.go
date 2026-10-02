// Command dbtool là client SQL tối giản thay thế `psql` cho các script e2e
// trong api/scripts/.
//
// Vì sao cần: bản Postgres chạy trên máy dev (zonky embedded binaries) chỉ có
// initdb / pg_ctl / postgres — KHÔNG kèm `psql`. Trong khi đó các test e2e cần:
//
//  1. Seed fixture mà HTTP API không diễn tả được: `renewalDate` trong quá khứ,
//     `lastNotifiedAt` 8 ngày trước, `status=EXPIRED`, ID cố định…
//  2. Đọc side-effect ở tầng DB: đếm `SubscriptionPayment`, so timestamp
//     `lastNotifiedAt` giữa hai lần chạy cron — không endpoint nào expose.
//  3. Dọn dẹp user test (DELETE FROM "User" … cascade).
//
// dbtool dùng chính driver pgx/v5 mà server dùng (đã có trong go.mod) nên
// không thêm dependency nào, và cách hiểu DATABASE_URL giống hệt server.
//
// Cách dùng (in kết quả theo định dạng `psql -tA`):
//
//	dbtool -c 'SELECT count(*) FROM "User"'
//	dbtool -f seed.sql
//	dbtool < seed.sql
//	dbtool -q -c 'DELETE FROM "User" WHERE email = ...'
//	dbtool -v user_id="'abc'" -f seed_dev.sql
//
// Hỗ trợ tối thiểu cú pháp psql mà seed_dev.sql cần: meta-command `\set NAME
// VALUE` (được ghi nhận; ON_ERROR_STOP luôn bật) và nội suy biến `:name` /
// `:'name'`. Meta-command khác báo lỗi thay vì bỏ qua im lặng.
//
// Đầu ra: mỗi dòng một row, các cột ngăn bằng `|`, NULL in ra rỗng — đúng định
// dạng `psql -tA` để assertion trong script giữ nguyên. Giá trị lấy ở dạng
// text thô từ server nên bool là `t`/`f`, timestamp là `2026-05-01 00:00:00`.
//
// Luôn bật ON_ERROR_STOP: gặp lỗi SQL là in ra stderr và exit 1 (mọi lời gọi
// psql cũ đều truyền `-v ON_ERROR_STOP=1`).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// queryTimeout chặn trường hợp script treo vì query bị khoá (lock) — seed dài
// nhất ở đây chỉ vài chục INSERT nên 60s là thừa thãi.
const queryTimeout = 60 * time.Second

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "dbtool: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("dbtool", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	var (
		command  = fs.String("c", "", "SQL chạy trực tiếp (bỏ trống thì đọc stdin)")
		filePath = fs.String("f", "", "đọc SQL từ file (mặc định: stdin)")
		quiet    = fs.Bool("q", false, "chỉ chạy, không in kết quả")
	)
	var vars stringList
	fs.Var(&vars, "v", "biến kiểu psql `name=value` (lặp lại được)")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: dbtool [-c SQL | -f FILE | < FILE] [-q] [-v name=value]…")
		fmt.Fprintln(os.Stderr, "  DATABASE_URL là biến môi trường bắt buộc.")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	raw, err := readSQL(*command, *filePath, fs.Args())
	if err != nil {
		return err
	}

	body, err := preprocess(raw, vars)
	if err != nil {
		return err
	}

	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		return errors.New("DATABASE_URL chưa được đặt")
	}

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("kết nối Postgres thất bại: %w", err)
	}
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	// PgConn().Exec dùng simple query protocol: chạy được nhiều câu lệnh trong
	// một lần gửi (heredoc seed) và trả về text thô của từng result set — nhờ
	// vậy không phải tự format bool/timestamp/bytea như đường extended protocol.
	// Chỉ dùng cho script test, không bao giờ nhận input từ người dùng cuối.
	results, err := conn.PgConn().Exec(ctx, body).ReadAll()
	if err != nil {
		return fmt.Errorf("chạy SQL thất bại: %w", err)
	}

	if !*quiet {
		for _, result := range results {
			// Result set không có cột (INSERT/UPDATE/DELETE) không in gì —
			// giống `psql -tA` ở chế độ tuples-only.
			if len(result.FieldDescriptions) == 0 {
				continue
			}
			for _, row := range result.Rows {
				if _, err := fmt.Fprintln(os.Stdout, formatRow(row)); err != nil {
					return fmt.Errorf("ghi stdout thất bại: %w", err)
				}
			}
		}
	}

	return nil
}

// readSQL lấy nội dung SQL từ -c, -f hoặc stdin (theo thứ tự ưu tiên đó).
func readSQL(command, filePath string, extra []string) (string, error) {
	if command != "" && filePath != "" {
		return "", errors.New("-c và -f loại trừ nhau")
	}
	if len(extra) > 0 {
		return "", fmt.Errorf("tham số không mong đợi: %v (dùng -c hoặc -f)", extra)
	}
	switch {
	case command != "":
		return command, nil
	case filePath != "":
		b, err := os.ReadFile(filePath) //nolint:gosec // đường dẫn do script test truyền vào
		if err != nil {
			return "", fmt.Errorf("đọc %s thất bại: %w", filePath, err)
		}
		return string(b), nil
	default:
		b, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", fmt.Errorf("đọc stdin thất bại: %w", err)
		}
		return string(b), nil
	}
}

// varPattern khớp `:name` hoặc `:'name'` (RE2 không có backreference nên viết
// thành hai nhánh). Cast `::text` bị loại ở bước kiểm tra ký tự đứng trước.
var varPattern = regexp.MustCompile(`:'([A-Za-z_][A-Za-z0-9_]*)'|:([A-Za-z_][A-Za-z0-9_]*)`)

// preprocess xử lý meta-command `\set` rồi nội suy biến kiểu psql.
func preprocess(sql string, flagVars map[string]string) (string, error) {
	vars := make(map[string]string, len(flagVars))
	for k, v := range flagVars {
		vars[k] = v
	}

	lines := strings.Split(sql, "\n")
	kept := make([]string, 0, len(lines))
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, `\`) {
			kept = append(kept, line)
			continue
		}
		name, value, ok := parseSet(trimmed)
		if !ok {
			return "", fmt.Errorf("dòng %d: meta-command psql không được hỗ trợ: %s", i+1, trimmed)
		}
		// `-v` của dòng lệnh thắng `\set` trong file, giống psql.
		if _, exists := vars[name]; !exists {
			vars[name] = value
		}
	}

	return interpolate(strings.Join(kept, "\n"), vars)
}

// parseSet nhận `\set NAME VALUE` (VALUE có thể chứa khoảng trắng).
func parseSet(line string) (name, value string, ok bool) {
	rest := strings.TrimSpace(strings.TrimPrefix(line, `\`))
	fields := strings.Fields(rest)
	if len(fields) < 2 || fields[0] != "set" {
		return "", "", false
	}
	name = fields[1]
	after := strings.TrimSpace(strings.TrimPrefix(rest, "set"))
	value = strings.TrimSpace(strings.TrimPrefix(after, name))
	return name, value, true
}

// interpolate thay `:name` bằng giá trị biến (và `:'name'` bằng literal đã
// quote). Biến chưa định nghĩa là lỗi — psql để nguyên rồi báo lỗi cú pháp khó
// hiểu, còn ở đây báo thẳng tên biến thiếu.
func interpolate(sql string, vars map[string]string) (string, error) {
	var (
		out  strings.Builder
		last int
	)
	for _, loc := range varPattern.FindAllStringSubmatchIndex(sql, -1) {
		// loc: [0:2]=toàn bộ match, [2:4]=nhóm `:'name'`, [4:6]=nhóm `:name`.
		start, end := loc[0], loc[1]
		quoted := loc[2] >= 0
		var name string
		if quoted {
			name = sql[loc[2]:loc[3]]
		} else {
			name = sql[loc[4]:loc[5]]
		}

		// `::text` — ký tự trước là ':' thì đây là cast, không phải biến.
		if start > 0 && sql[start-1] == ':' {
			continue
		}

		value, ok := vars[name]
		if !ok {
			return "", fmt.Errorf("biến :%s chưa được truyền (dùng -v %s=…)", name, name)
		}
		if quoted {
			value = quoteLiteral(value)
		}

		out.WriteString(sql[last:start])
		out.WriteString(value)
		last = end
	}
	out.WriteString(sql[last:])
	return out.String(), nil
}

// quoteLiteral escape một giá trị thành literal SQL an toàn cho `:'name'`.
func quoteLiteral(v string) string {
	return "'" + strings.ReplaceAll(v, "'", "''") + "'"
}

// formatRow nối các cột bằng `|`, NULL (nil) thành chuỗi rỗng — đúng định dạng
// `psql -tA`.
func formatRow(row [][]byte) string {
	parts := make([]string, len(row))
	for i, cell := range row {
		parts[i] = string(cell)
	}
	return strings.Join(parts, "|")
}

// stringList thu thập flag -v lặp lại được thành map name=value.
type stringList map[string]string

func (s *stringList) String() string {
	if s == nil || *s == nil {
		return ""
	}
	parts := make([]string, 0, len(*s))
	for k, v := range *s {
		parts = append(parts, k+"="+v)
	}
	return strings.Join(parts, ",")
}

func (s *stringList) Set(raw string) error {
	name, value, ok := strings.Cut(raw, "=")
	if !ok || name == "" {
		return fmt.Errorf("định dạng phải là name=value, nhận được %q", raw)
	}
	if *s == nil {
		*s = make(map[string]string)
	}
	(*s)[name] = value
	return nil
}
