// Package parser parses raw RFC-5322 email headers and returns structured
// analysis results. All processing is done in memory; nothing is stored.
package parser

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// Hard limits to prevent memory exhaustion from malformed/malicious inputs.
const (
	maxHeaders     = 500
	maxHops        = 100
	maxHeaderBytes = 8192 // max length of a single header value
)

// ErrMalformed is returned for inputs that exceed safety limits.
var ErrMalformed = errors.New("input exceeds safety limits")

// Result is the full analysis result returned as JSON.
type Result struct {
	Summary   Summary    `json:"summary"`
	Headers   []Header   `json:"headers"`
	Hops      []Hop      `json:"hops"`
	Auth      AuthResult `json:"auth"`
	Security  Security   `json:"security"`
	Truncated bool       `json:"truncated"` // true if headers were capped at maxHeaders
}

// Summary holds the most important header fields.
type Summary struct {
	From        string `json:"from"`
	To          string `json:"to"`
	Subject     string `json:"subject"`
	Date        string `json:"date"`
	MessageID   string `json:"message_id"`
	ReplyTo     string `json:"reply_to"`
	XMailer     string `json:"x_mailer"`
	MIMEVersion string `json:"mime_version"`
}

// Header is a single header line with an optional UI flag.
type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Flag  string `json:"flag"` // "", "warn", "danger", "info"
}

// Hop represents one Received header (one routing step).
type Hop struct {
	From      string `json:"from"`
	By        string `json:"by"`
	With      string `json:"with"`
	Timestamp string `json:"timestamp"`
	Delay     int    `json:"delay"` // seconds from previous hop
	IP        string `json:"ip"`
	Index     int    `json:"index"`
}

// AuthResult holds SPF/DKIM/DMARC/ARC results.
type AuthResult struct {
	SPF   AuthEntry `json:"spf"`
	DKIM  AuthEntry `json:"dkim"`
	DMARC AuthEntry `json:"dmarc"`
	ARC   AuthEntry `json:"arc"`
}

// AuthEntry holds one authentication protocol result.
type AuthEntry struct {
	Result  string `json:"result"`
	Details string `json:"details"`
}

// Security holds the computed security score and structured issues.
type Security struct {
	Score  int     `json:"score"`
	Issues []Issue `json:"issues"`
	Passed []Pass  `json:"passed"`
}

// Issue is a structured security finding with a code for i18n.
type Issue struct {
	Severity string   `json:"severity"`
	Code     string   `json:"code"`
	Params   []string `json:"params,omitempty"`
}

// Pass is a structured security pass with a code for i18n.
type Pass struct {
	Code string `json:"code"`
}

var (
	reIP           = regexp.MustCompile(`\b(\d{1,3}\.){3}\d{1,3}\b`)
	reReceivedFrom = regexp.MustCompile(`(?i)from\s+(\S{1,253})(?:\s+\(([^)]{0,512})\))?`)
	reReceivedBy   = regexp.MustCompile(`(?i)by\s+(\S{1,253})`)
	reReceivedWith = regexp.MustCompile(`(?i)with\s+(\S{1,64})`)
	reReceivedDate = regexp.MustCompile(`(?i);\s*(.{1,64})$`)
	reSPF          = regexp.MustCompile(`(?i)spf=(\w{1,16})`)
	reDKIM         = regexp.MustCompile(`(?i)dkim=(\w{1,16})`)
	reDMARC        = regexp.MustCompile(`(?i)dmarc=(\w{1,16})`)
	reARC          = regexp.MustCompile(`(?i)arc=(\w{1,16})`)
	reXSpam        = regexp.MustCompile(`(?i)x-spam`)
)

// Parse parses raw email headers (or full .eml) and returns a Result.
// Nothing is stored; all data lives in memory during this call only.
func Parse(raw string) (*Result, error) {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	// Hard cap on total input size before any allocation-heavy processing.
	// The HTTP layer already limits to 5 MB; this is defence-in-depth inside the parser.
	const maxInputBytes = 5 << 20 // 5 MB
	if len(raw) > maxInputBytes {
		return nil, ErrMalformed
	}

	// Keep only the header section
	if idx := strings.Index(raw, "\n\n"); idx != -1 {
		raw = raw[:idx]
	}
	raw = unfold(raw)

	msg, err := mail.ReadMessage(strings.NewReader(raw + "\n\n"))
	if err != nil {
		return parseManually(raw)
	}

	result := &Result{
		Headers: []Header{},
		Hops:    []Hop{},
	}
	h := msg.Header

	result.Summary = Summary{
		From:        truncate(h.Get("From"), maxHeaderBytes),
		To:          truncate(h.Get("To"), maxHeaderBytes),
		Subject:     truncate(h.Get("Subject"), maxHeaderBytes),
		Date:        truncate(h.Get("Date"), 64),
		MessageID:   truncate(h.Get("Message-ID"), 256),
		ReplyTo:     truncate(h.Get("Reply-To"), maxHeaderBytes),
		XMailer:     truncate(h.Get("X-Mailer"), 256),
		MIMEVersion: truncate(h.Get("MIME-Version"), 32),
	}

	// Iterate line-by-line with a scanner instead of strings.Split to avoid
	// allocating a []string with millions of entries before the maxHeaders cap.
	headerScanner := bufio.NewScanner(strings.NewReader(raw))
	headerScanner.Buffer(make([]byte, maxHeaderBytes*2), maxHeaderBytes*2)
	for headerScanner.Scan() {
		line := headerScanner.Text()
		if line == "" || line[0] == ' ' || line[0] == '\t' {
			continue
		}
		if len(result.Headers) >= maxHeaders {
			result.Truncated = true
			break
		}
		col := strings.Index(line, ":")
		if col < 0 {
			continue
		}
		name := strings.TrimSpace(line[:col])
		value := truncate(strings.TrimSpace(line[col+1:]), maxHeaderBytes)
		result.Headers = append(result.Headers, Header{
			Name:  name,
			Value: value,
			Flag:  flagForHeader(name, value),
		})
	}

	receivedHeaders := h["Received"]
	// Reverse: index 0 = origin sender
	for i, j := 0, len(receivedHeaders)-1; i < j; i, j = i+1, j-1 {
		receivedHeaders[i], receivedHeaders[j] = receivedHeaders[j], receivedHeaders[i]
	}
	var times []time.Time
	for i, rv := range receivedHeaders {
		if i >= maxHops {
			break
		}
		hop := parseReceived(truncate(rv, maxHeaderBytes), i)
		if i > 0 && len(times) > 0 && !times[len(times)-1].IsZero() && !hop.ts().IsZero() {
			hop.Delay = int(hop.ts().Sub(times[len(times)-1]).Seconds())
		}
		times = append(times, hop.ts())
		result.Hops = append(result.Hops, hop)
	}

	result.Auth = parseAuth(h)
	result.Security = computeSecurity(result)
	return result, nil
}

// truncate caps a string at n bytes to prevent oversized values flowing into JSON.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func unfold(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		if i > 0 && len(line) > 0 && (line[0] == ' ' || line[0] == '\t') {
			b.WriteByte(' ')
			b.WriteString(strings.TrimSpace(line))
		} else {
			if i > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(line)
		}
	}
	return b.String()
}

func flagForHeader(name, value string) string {
	lower := strings.ToLower(name)
	switch lower {
	case "x-spam-status":
		if strings.Contains(strings.ToLower(value), "yes") {
			return "danger"
		}
		return "info"
	case "x-spam-flag":
		if strings.EqualFold(strings.TrimSpace(value), "yes") {
			return "danger"
		}
	case "x-mailer", "user-agent":
		return "info"
	case "reply-to":
		return "warn"
	case "bcc":
		return "warn"
	case "dkim-signature":
		return "info"
	case "received-spf":
		lv := strings.ToLower(value)
		if strings.Contains(lv, "fail") {
			return "danger"
		}
		if strings.Contains(lv, "pass") {
			return "info"
		}
	}
	if reXSpam.MatchString(name) {
		return "warn"
	}
	return ""
}

func (h *Hop) ts() time.Time {
	if h.Timestamp == "" {
		return time.Time{}
	}
	formats := []string{
		"Mon, 2 Jan 2006 15:04:05 -0700",
		"Mon, 2 Jan 2006 15:04:05 -0700 (MST)",
		"2 Jan 2006 15:04:05 -0700",
		"Mon, 2 Jan 2006 15:04:05 MST",
		"2 Jan 2006 15:04:05 MST",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, strings.TrimSpace(h.Timestamp)); err == nil {
			return t
		}
	}
	return time.Time{}
}

func parseReceived(rv string, idx int) Hop {
	hop := Hop{Index: idx}
	if m := reReceivedFrom.FindStringSubmatch(rv); m != nil {
		hop.From = m[1]
		if m[2] != "" {
			if ips := reIP.FindAllString(m[2], 2); len(ips) > 0 {
				hop.IP = ips[0]
			}
		}
	}
	if hop.IP == "" {
		for _, ip := range reIP.FindAllString(rv, 8) {
			if !isPrivateIP(ip) {
				hop.IP = ip
				break
			}
		}
	}
	if m := reReceivedBy.FindStringSubmatch(rv); m != nil {
		hop.By = m[1]
	}
	if m := reReceivedWith.FindStringSubmatch(rv); m != nil {
		hop.With = m[1]
	}
	if m := reReceivedDate.FindStringSubmatch(rv); m != nil {
		hop.Timestamp = strings.TrimSpace(m[1])
	}
	return hop
}

func isPrivateIP(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return true
	}
	for _, cidr := range []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"} {
		_, block, _ := net.ParseCIDR(cidr)
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

func parseAuth(h mail.Header) AuthResult {
	ar := AuthResult{
		SPF:   AuthEntry{Result: "none"},
		DKIM:  AuthEntry{Result: "none"},
		DMARC: AuthEntry{Result: "none"},
		ARC:   AuthEntry{Result: "none"},
	}
	for _, authLine := range h["Authentication-Results"] {
		lower := strings.ToLower(authLine)
		if m := reSPF.FindStringSubmatch(lower); m != nil {
			ar.SPF = AuthEntry{Result: m[1], Details: truncate(extractDetail(authLine, "spf"), 256)}
		}
		if m := reDKIM.FindStringSubmatch(lower); m != nil {
			ar.DKIM = AuthEntry{Result: m[1], Details: truncate(extractDetail(authLine, "dkim"), 256)}
		}
		if m := reDMARC.FindStringSubmatch(lower); m != nil {
			ar.DMARC = AuthEntry{Result: m[1], Details: truncate(extractDetail(authLine, "dmarc"), 256)}
		}
		if m := reARC.FindStringSubmatch(lower); m != nil {
			ar.ARC = AuthEntry{Result: m[1]}
		}
	}
	if ar.SPF.Result == "none" {
		for _, spfLine := range h["Received-Spf"] {
			fields := strings.Fields(spfLine)
			if len(fields) > 0 {
				ar.SPF = AuthEntry{Result: strings.ToLower(fields[0]), Details: truncate(spfLine, 256)}
			}
		}
	}
	if ar.DKIM.Result == "none" && len(h["Dkim-Signature"]) > 0 {
		ar.DKIM = AuthEntry{Result: "present", Details: "DKIM-Signature header found (not verified)"}
	}
	return ar
}

func extractDetail(line, proto string) string {
	idx := strings.Index(strings.ToLower(line), proto+"=")
	if idx < 0 {
		return ""
	}
	sub := line[idx:]
	if end := strings.Index(sub, ";"); end > 0 {
		return strings.TrimSpace(sub[:end])
	}
	return strings.TrimSpace(sub)
}

func computeSecurity(r *Result) Security {
	sec := Security{
		Score:  100,
		Issues: []Issue{},
		Passed: []Pass{},
	}

	switch r.Auth.SPF.Result {
	case "pass":
		sec.Passed = append(sec.Passed, Pass{"spfPass"})
	case "fail", "softfail":
		sec.Issues = append(sec.Issues, Issue{"high", "spfFail", []string{r.Auth.SPF.Result}})
		sec.Score -= 25
	case "none":
		sec.Issues = append(sec.Issues, Issue{"medium", "noSpf", []string{}})
		sec.Score -= 15
	default:
		sec.Issues = append(sec.Issues, Issue{"low", "spfResult", []string{r.Auth.SPF.Result}})
		sec.Score -= 5
	}

	switch r.Auth.DKIM.Result {
	case "pass":
		sec.Passed = append(sec.Passed, Pass{"dkimPass"})
	case "fail":
		sec.Issues = append(sec.Issues, Issue{"high", "dkimFail", []string{}})
		sec.Score -= 25
	case "none":
		sec.Issues = append(sec.Issues, Issue{"medium", "noDkim", []string{}})
		sec.Score -= 10
	case "present":
		sec.Issues = append(sec.Issues, Issue{"low", "dkimPresent", []string{}})
		sec.Score -= 5
	}

	switch r.Auth.DMARC.Result {
	case "pass":
		sec.Passed = append(sec.Passed, Pass{"dmarcPass"})
	case "fail":
		sec.Issues = append(sec.Issues, Issue{"high", "dmarcFail", []string{}})
		sec.Score -= 20
	case "none":
		sec.Issues = append(sec.Issues, Issue{"low", "noDmarc", []string{}})
		sec.Score -= 5
	}

	// ARC: only scored when present — none is neutral (optional protocol)
	switch r.Auth.ARC.Result {
	case "pass":
		sec.Passed = append(sec.Passed, Pass{"arcPass"})
	case "fail":
		sec.Issues = append(sec.Issues, Issue{"medium", "arcFail", []string{}})
		sec.Score -= 10
	}

	if r.Summary.ReplyTo != "" && r.Summary.From != "" {
		fromAddr := extractEmail(r.Summary.From)
		replyAddr := extractEmail(r.Summary.ReplyTo)
		if fromAddr != "" && replyAddr != "" && !strings.EqualFold(fromAddr, replyAddr) {
			fromDomain := domainOf(fromAddr)
			replyDomain := domainOf(replyAddr)
			if fromDomain != replyDomain {
				sec.Issues = append(sec.Issues, Issue{"high", "replyToDiff", []string{replyDomain, fromDomain}})
				sec.Score -= 20
			} else {
				sec.Issues = append(sec.Issues, Issue{"low", "replyToSame", []string{}})
				sec.Score -= 5
			}
		}
	}

	for _, h := range r.Headers {
		if strings.EqualFold(h.Name, "X-Spam-Flag") && strings.EqualFold(strings.TrimSpace(h.Value), "YES") {
			sec.Issues = append(sec.Issues, Issue{"high", "spamFlag", []string{}})
			sec.Score -= 20
			break
		}
	}

	for _, hop := range r.Hops {
		if hop.Delay > 3600 {
			sec.Issues = append(sec.Issues, Issue{"low", "hopDelay", []string{
				fmt.Sprintf("%d", hop.Index+1),
				fmt.Sprintf("%d", hop.Delay),
			}})
		}
	}

	if len(sec.Issues) == 0 {
		sec.Passed = append(sec.Passed, Pass{"noIssues"})
	}
	if sec.Score < 0 {
		sec.Score = 0
	}
	return sec
}

func extractEmail(s string) string {
	addr, err := mail.ParseAddress(s)
	if err != nil {
		s = strings.TrimSpace(s)
		if strings.Contains(s, "@") {
			return s
		}
		return ""
	}
	return addr.Address
}

func domainOf(email string) string {
	parts := strings.Split(email, "@")
	if len(parts) == 2 {
		return strings.ToLower(parts[1])
	}
	return ""
}

// canonicalHeader converts a lowercase header name to canonical Title-Case
// using ASCII-only rules, replacing the deprecated strings.Title.
// e.g. "authentication-results" → "Authentication-Results"
func canonicalHeader(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	upper := true
	for _, r := range s {
		if r == '-' {
			b.WriteRune(r)
			upper = true
		} else if upper {
			b.WriteRune(unicode.ToUpper(r))
			upper = false
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// parseManually is the fallback parser for inputs that net/mail rejects.
func parseManually(raw string) (*Result, error) {
	// Input cap already checked in Parse() before this call.
	result := &Result{
		Headers: []Header{},
		Hops:    []Hop{},
	}
	// Use a scanner with a 1 MB token buffer to handle large DKIM-Signature headers
	scanner := bufio.NewScanner(strings.NewReader(raw))
	scanner.Buffer(make([]byte, 1<<20), 1<<20)

	var currentName, currentValue string
	headerMap := map[string][]string{}
	headerCount := 0

	flush := func() {
		if currentName == "" {
			return
		}
		if headerCount >= maxHeaders {
			result.Truncated = true
			return
		}
		headerCount++
		lower := strings.ToLower(currentName)
		val := truncate(currentValue, maxHeaderBytes)
		headerMap[lower] = append(headerMap[lower], val)
		result.Headers = append(result.Headers, Header{
			Name:  currentName,
			Value: val,
			Flag:  flagForHeader(currentName, val),
		})
	}

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			break
		}
		if line[0] == ' ' || line[0] == '\t' {
			if len(currentValue) < maxHeaderBytes {
				currentValue += " " + strings.TrimSpace(line)
			}
			continue
		}
		flush()
		col := strings.Index(line, ":")
		if col < 0 {
			currentName = ""
			currentValue = ""
			continue
		}
		currentName = strings.TrimSpace(line[:col])
		currentValue = strings.TrimSpace(line[col+1:])
	}
	// scanner.Err() is intentionally checked — a too-long line returns an error
	if err := scanner.Err(); err != nil {
		// Partial parse: continue with what we have rather than failing completely
		_ = err
	}
	flush()

	get := func(key string) string {
		if vals := headerMap[strings.ToLower(key)]; len(vals) > 0 {
			return vals[0]
		}
		return ""
	}

	result.Summary = Summary{
		From:        get("from"),
		To:          get("to"),
		Subject:     get("subject"),
		Date:        get("date"),
		MessageID:   get("message-id"),
		ReplyTo:     get("reply-to"),
		XMailer:     get("x-mailer"),
		MIMEVersion: get("mime-version"),
	}

	for i, rv := range headerMap["received"] {
		if i >= maxHops {
			break
		}
		result.Hops = append(result.Hops, parseReceived(rv, i))
	}

	// Build mail.Header using our canonical casing function (not deprecated strings.Title)
	mh := mail.Header{}
	for k, vals := range headerMap {
		mh[canonicalHeader(k)] = vals
	}
	result.Auth = parseAuth(mh)
	result.Security = computeSecurity(result)
	return result, nil
}
