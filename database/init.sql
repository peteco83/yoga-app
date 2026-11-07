-- Yoga App Database Schema

-- Admins table
CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Members table
CREATE TABLE members (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(20),
    group_name VARCHAR(100) NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    notes_updated_at TIMESTAMP NULL,
    join_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Contact messages table
CREATE TABLE contact_messages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(120) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'unread',
    assignee VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert a default admin (password: admin123, hashed)
-- Note: In production, hash passwords properly and change the default password
INSERT INTO admins (username, password_hash) VALUES ('admin', '$2a$10$hWBUlugRq9GMxeYSmsXOJ.aeaaiV2/RKCzF.H3JZ24NkPH49egTA.');
