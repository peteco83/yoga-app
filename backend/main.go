package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

type Admin struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type Member struct {
	ID             int        `json:"id"`
	Name           string     `json:"name"`
	Email          string     `json:"email"`
	Phone          string     `json:"phone"`
	Notes          string     `json:"notes"`
	NotesUpdatedAt *time.Time `json:"notes_updated_at,omitempty"`
	JoinDate       time.Time  `json:"join_date"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type MemberRequest struct {
	Name     string `json:"name" binding:"required"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Notes    string `json:"notes"`
	JoinDate string `json:"join_date"`
}

type ContactRequest struct {
	Name    string `json:"name" binding:"required"`
	Email   string `json:"email" binding:"required,email"`
	Message string `json:"message" binding:"required"`
}

type ContactMessage struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Message   string    `json:"message"`
	Status    string    `json:"status"`
	Assignee  *string   `json:"assignee,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

var contactEmailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)

var db *sql.DB
var jwtSecret = []byte(os.Getenv("JWT_SECRET"))

func init() {
	if len(jwtSecret) == 0 {
		log.Fatal("JWT_SECRET must be configured")
	}
}

func main() {
	var err error
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		connStr = "postgres://yoga_admin:yoga_pass@localhost:5432/yoga_app?sslmode=disable"
	}
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if err = db.Ping(); err != nil {
		log.Fatal(err)
	}

	if _, err := db.Exec(`ALTER TABLE contact_messages
		ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'unread',
		ADD COLUMN IF NOT EXISTS assignee VARCHAR(100)`); err != nil {
		log.Fatalf("failed applying contact_messages schema update: %v", err)
	}

	// Older database versions may contain a required group_name column even
	// though the current member form does not collect a group.
	if _, err := db.Exec(`ALTER TABLE members ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);
		UPDATE members SET group_name = '' WHERE group_name IS NULL;
		ALTER TABLE members ALTER COLUMN group_name SET DEFAULT '';
		ALTER TABLE members ALTER COLUMN group_name SET NOT NULL;
		ALTER TABLE members ALTER COLUMN email DROP NOT NULL;
		ALTER TABLE members ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
		ALTER TABLE members ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMP NULL`); err != nil {
		log.Fatalf("failed applying members schema update: %v", err)
	}

	r := gin.Default()

	// Requests arrive through nginx inside the Compose network: trust the
	// private ranges so the logs show the visitor instead of the proxy.
	if err := r.SetTrustedProxies([]string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}); err != nil {
		log.Printf("could not configure trusted proxies: %v", err)
	}

	r.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins(),
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	r.GET("/health", health)
	r.POST("/login", login)
	r.POST("/contact", contact)

	protected := r.Group("/")
	protected.Use(authMiddleware())
	{
		protected.GET("/members", getMembers)
		protected.POST("/members", createMember)
		protected.PUT("/members/:id", updateMember)
		protected.DELETE("/members/:id", deleteMember)
		protected.GET("/contact-messages", getContactMessages)
		protected.DELETE("/contact-messages/:id", deleteContactMessage)
		protected.PUT("/contact-messages/:id/read", markContactMessageRead)
		protected.PUT("/contact-messages/:id/unread", markContactMessageUnread)
		protected.PATCH("/contact-messages/:id/assign", assignContactMessage)
	}

	srv := &http.Server{
		Addr:              ":8080",
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()
	log.Printf("API listening on %s", srv.Addr)

	// Docker sends SIGTERM on every redeploy: finish in-flight requests first.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	log.Println("API stopped")
}

// allowedOrigins reads extra browser origins from ALLOWED_ORIGINS (comma
// separated). The public site calls /api on its own origin, so it needs no
// entry; the defaults only cover local development.
func allowedOrigins() []string {
	origins := []string{}
	for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	if len(origins) == 0 {
		origins = []string{
			"http://localhost",
			"http://localhost:4200",
			"http://localhost:8081",
			"http://localhost:5007",
		}
	}
	return origins
}

// health is polled by Docker Compose and can be used as an uptime check.
func health(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Printf("health check failed: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var admin Admin
	err := db.QueryRow("SELECT id, username, password_hash FROM admins WHERE username = $1", req.Username).Scan(&admin.ID, &admin.Username, &admin.PasswordHash)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"admin_id": admin.ID,
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"token": tokenString})
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := c.GetHeader("Authorization")
		if tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Missing token"})
			return
		}

		// Support "Bearer <token>" header format
		if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
			tokenString = tokenString[7:]
		}

		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			return jwtSecret, nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			return
		}

		c.Next()
	}
}

func contact(c *gin.Context) {
	var req ContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	if !contactEmailPattern.MatchString(req.Email) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please provide a valid email address"})
		return
	}

	var savedId int
	err := db.QueryRow("INSERT INTO contact_messages (name, email, message, status) VALUES ($1, $2, $3, 'unread') RETURNING id", req.Name, req.Email, req.Message).Scan(&savedId)
	if err != nil {
		log.Printf("Contact insert error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save contact message"})
		return
	}

	log.Printf("Contact message saved id=%d", savedId)
	c.JSON(http.StatusCreated, gin.H{"message": "Contact request received"})
}

func getContactMessages(c *gin.Context) {
	rows, err := db.Query("SELECT id, name, email, message, status, assignee, created_at FROM contact_messages ORDER BY created_at DESC")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var messages []ContactMessage
	for rows.Next() {
		var msg ContactMessage
		if err := rows.Scan(&msg.ID, &msg.Name, &msg.Email, &msg.Message, &msg.Status, &msg.Assignee, &msg.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		messages = append(messages, msg)
	}

	c.JSON(http.StatusOK, messages)
}

func deleteContactMessage(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid id"})
		return
	}

	result, err := db.Exec("DELETE FROM contact_messages WHERE id = $1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rows, err := result.RowsAffected()
	if err != nil || rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Deleted"})
}

func markContactMessageRead(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid id"})
		return
	}

	result, err := db.Exec("UPDATE contact_messages SET status='read' WHERE id = $1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rows, err := result.RowsAffected()
	if err != nil || rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Marked as read"})
}

func markContactMessageUnread(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid id"})
		return
	}

	result, err := db.Exec("UPDATE contact_messages SET status='unread' WHERE id = $1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rows, err := result.RowsAffected()
	if err != nil || rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Marked as read"})
}

func assignContactMessage(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid id"})
		return
	}

	var body struct {
		Assignee string `json:"assignee" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := db.Exec("UPDATE contact_messages SET assignee=$1 WHERE id=$2", body.Assignee, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rows, err := result.RowsAffected()
	if err != nil || rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Assigned"})
}

func getMembers(c *gin.Context) {
	rows, err := db.Query("SELECT id, name, COALESCE(email, ''), COALESCE(phone, ''), COALESCE(notes, ''), notes_updated_at, join_date, created_at, updated_at FROM members")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var members []Member
	for rows.Next() {
		var m Member
		var notesUpdatedAt sql.NullTime
		err := rows.Scan(&m.ID, &m.Name, &m.Email, &m.Phone, &m.Notes, &notesUpdatedAt, &m.JoinDate, &m.CreatedAt, &m.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if notesUpdatedAt.Valid {
			m.NotesUpdatedAt = &notesUpdatedAt.Time
		}
		members = append(members, m)
	}

	c.JSON(http.StatusOK, members)
}

func createMember(c *gin.Context) {
	var req MemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}
	if strings.TrimSpace(req.Email) == "" && strings.TrimSpace(req.Phone) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email or phone is required"})
		return
	}
	if req.JoinDate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Join date is required"})
		return
	}

	joinDate := time.Now()
	if req.JoinDate != "" {
		var err error
		joinDate, err = time.Parse("2006-01-02", req.JoinDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid join_date format"})
			return
		}
	}

	var id int
	notes := strings.TrimSpace(req.Notes)
	err := db.QueryRow("INSERT INTO members (name, email, phone, notes, notes_updated_at, join_date) VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, CASE WHEN $4 <> '' THEN CURRENT_TIMESTAMP ELSE NULL END, $5) RETURNING id", strings.TrimSpace(req.Name), strings.TrimSpace(req.Email), strings.TrimSpace(req.Phone), notes, joinDate).Scan(&id)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			c.JSON(http.StatusConflict, gin.H{"error": "Email already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func updateMember(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	var req MemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}
	if strings.TrimSpace(req.Email) == "" && strings.TrimSpace(req.Phone) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email or phone is required"})
		return
	}
	if req.JoinDate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Join date is required"})
		return
	}

	joinDate := time.Now()
	if req.JoinDate != "" {
		joinDate, err = time.Parse("2006-01-02", req.JoinDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid join_date format"})
			return
		}
	}

	notes := strings.TrimSpace(req.Notes)
	_, err = db.Exec("UPDATE members SET name = $1, email = NULLIF($2, ''), phone = NULLIF($3, ''), notes = $4, notes_updated_at = CASE WHEN notes IS DISTINCT FROM $4 THEN CASE WHEN $4 <> '' THEN CURRENT_TIMESTAMP ELSE NULL END ELSE notes_updated_at END, join_date = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6", strings.TrimSpace(req.Name), strings.TrimSpace(req.Email), strings.TrimSpace(req.Phone), notes, joinDate, id)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			c.JSON(http.StatusConflict, gin.H{"error": "Email already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Member updated"})
}

func deleteMember(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	_, err = db.Exec("DELETE FROM members WHERE id = $1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Member deleted"})
}
