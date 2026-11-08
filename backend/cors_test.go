package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// testRouter mirrors the middleware chain that decides whether a login attempt
// from a browser is accepted: the same-origin bypass and then gin-contrib/cors
// with the production configuration.
func testRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(ignoreSameOriginHeader)
	r.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins(),
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))
	r.POST("/login", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r
}

func postLogin(r *gin.Engine, host, origin string) int {
	req := httptest.NewRequest(http.MethodPost, "http://"+host+"/login",
		strings.NewReader(`{"username":"admin","password":"secret"}`))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec.Code
}

// Browsers send Origin even on same-origin requests, so the site behind nginx
// must keep working with an empty ALLOWED_ORIGINS (the 403 regression).
func TestLoginFromSameOriginIsAccepted(t *testing.T) {
	r := testRouter()

	cases := []struct {
		name   string
		host   string
		origin string
	}{
		{"LAN address, nginx drops the port from Host", "192.168.1.20", "http://192.168.1.20:5007"},
		{"LAN address, Host keeps the port", "192.168.1.20:5007", "http://192.168.1.20:5007"},
		{"public hostname behind Cloudflare", "momkari.example", "https://momkari.example"},
		{"command line client without Origin", "192.168.1.20", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if code := postLogin(r, tc.host, tc.origin); code != http.StatusOK {
				t.Fatalf("status = %d, want %d", code, http.StatusOK)
			}
		})
	}
}

// A page on another origin must still be rejected unless it is listed.
func TestLoginFromForeignOriginIsForbidden(t *testing.T) {
	r := testRouter()

	if code := postLogin(r, "192.168.1.20", "https://evil.example"); code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", code, http.StatusForbidden)
	}
}

// ALLOWED_ORIGINS keeps working for frontends that really live elsewhere, such
// as the Angular dev server.
func TestLoginFromListedOriginIsAccepted(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "http://localhost:4200")
	r := testRouter()

	if code := postLogin(r, "api.internal", "http://localhost:4200"); code != http.StatusOK {
		t.Fatalf("status = %d, want %d", code, http.StatusOK)
	}
}

func TestOriginHostname(t *testing.T) {
	cases := []struct {
		origin string
		want   string
	}{
		{"http://192.168.1.20:5007", "192.168.1.20"},
		{"https://momkari.example", "momkari.example"},
		{"HTTPS://Example.COM", "example.com"},
		{"", ""},
		{"null", ""},
		{"https://", ""},
	}

	for _, tc := range cases {
		if got := originHostname(tc.origin); got != tc.want {
			t.Errorf("originHostname(%q) = %q, want %q", tc.origin, got, tc.want)
		}
	}
}

func TestRequestHostname(t *testing.T) {
	cases := []struct {
		url  string
		want string
	}{
		{"http://192.168.1.20/login", "192.168.1.20"},
		{"http://192.168.1.20:5007/login", "192.168.1.20"},
		{"https://Momkari.Example/login", "momkari.example"},
		{"http://[::1]:8080/login", "::1"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodPost, tc.url, nil)
		if got := requestHostname(req); got != tc.want {
			t.Errorf("requestHostname(%q) = %q, want %q", tc.url, got, tc.want)
		}
	}
}

// allowedOrigins must never return an empty list: gin-contrib/cors treats an
// empty allow list as "nothing is allowed" and answers 403 to every browser.
func TestAllowedOriginsFallsBackToDevelopmentOrigins(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "")
	if origins := allowedOrigins(); len(origins) == 0 {
		t.Fatal("allowedOrigins returned an empty list")
	}

	t.Setenv("ALLOWED_ORIGINS", " http://a.example , http://b.example ")
	origins := allowedOrigins()
	if len(origins) != 2 || origins[0] != "http://a.example" || origins[1] != "http://b.example" {
		t.Fatalf("allowedOrigins = %v, want the two trimmed entries", origins)
	}
}
