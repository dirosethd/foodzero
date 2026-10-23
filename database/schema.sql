/*  FoodZero — скрипт базы данных для SQL Server
    Откройте в SSMS 22 (File → Open → File…) и нажмите Execute (F5).
    Скрипт можно запускать повторно: он пересоздаёт таблицы и тестовые данные.
*/

IF DB_ID(N'FoodZero') IS NULL
    CREATE DATABASE FoodZero;
GO

USE FoodZero;
GO

/* ---------- Логин для сайта (SQL Server Authentication) ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'foodzero_app')
    CREATE LOGIN foodzero_app WITH PASSWORD = N'FoodZero_Strong#2026', CHECK_POLICY = OFF;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'foodzero_app')
    CREATE USER foodzero_app FOR LOGIN foodzero_app;
GO
ALTER ROLE db_datareader ADD MEMBER foodzero_app;
ALTER ROLE db_datawriter ADD MEMBER foodzero_app;
GO

/* ---------- Таблицы ---------- */
IF OBJECT_ID(N'dbo.Reservations', N'U') IS NOT NULL DROP TABLE dbo.Reservations;
IF OBJECT_ID(N'dbo.MenuItems',    N'U') IS NOT NULL DROP TABLE dbo.MenuItems;
IF OBJECT_ID(N'dbo.Users',        N'U') IS NOT NULL DROP TABLE dbo.Users;
GO

CREATE TABLE dbo.Users (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    Email         NVARCHAR(255)  NOT NULL,
    Name          NVARCHAR(100)  NOT NULL,
    PasswordHash  NVARCHAR(255)  NULL,      -- NULL, если пользователь входит только через Google
    GoogleId      NVARCHAR(64)   NULL,
    AvatarUrl     NVARCHAR(500)  NULL,
    CreatedAt     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Users_Email UNIQUE (Email)
);
CREATE UNIQUE INDEX UX_Users_GoogleId ON dbo.Users(GoogleId) WHERE GoogleId IS NOT NULL;
GO

CREATE TABLE dbo.MenuItems (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Category    NVARCHAR(50)   NOT NULL,
    Name        NVARCHAR(100)  NOT NULL,
    Description NVARCHAR(300)  NOT NULL,
    Price       DECIMAL(10,2)  NOT NULL,
    ImageUrl    NVARCHAR(500)  NULL,
    IsFeatured  BIT            NOT NULL DEFAULT 0,
    SortOrder   INT            NOT NULL DEFAULT 0
);
GO

CREATE TABLE dbo.Reservations (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    UserId      INT            NULL REFERENCES dbo.Users(Id) ON DELETE SET NULL,
    Name        NVARCHAR(100)  NOT NULL,
    Email       NVARCHAR(255)  NOT NULL,
    Phone       NVARCHAR(30)   NOT NULL,
    Guests      INT            NOT NULL CHECK (Guests BETWEEN 1 AND 20),
    ReservedAt  DATETIME2      NOT NULL,
    Comment     NVARCHAR(500)  NULL,
    CreatedAt   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------- Тестовые данные меню ---------- */
INSERT INTO dbo.MenuItems (Category, Name, Description, Price, ImageUrl, IsFeatured, SortOrder) VALUES
(N'Starters',  N'Greek Salad',           N'Tomatoes, cucumber, red onion, olives, feta and oregano dressing', 12.00, N'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=80', 1, 1),
(N'Starters',  N'Bruschetta Trio',       N'Grilled sourdough with tomato-basil, mushroom and ricotta toppings', 9.50, N'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=600&q=80', 0, 2),
(N'Starters',  N'Pumpkin Soup',          N'Roasted pumpkin, coconut cream, toasted seeds',                    8.00, N'https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?w=600&q=80', 0, 3),
(N'Main Dish', N'Grilled Salmon',        N'Atlantic salmon, lemon butter, asparagus and baby potatoes',       24.00, N'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=80', 1, 1),
(N'Main Dish', N'Buddha Bowl',           N'Quinoa, chickpeas, avocado, roasted vegetables, tahini',           16.00, N'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&q=80', 1, 2),
(N'Main Dish', N'Ribeye Steak',          N'Dry-aged ribeye, chimichurri, grilled greens',                     32.00, N'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=80', 0, 3),
(N'Main Dish', N'Pasta Primavera',       N'Fresh pasta, seasonal vegetables, parmesan, olive oil',            15.00, N'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600&q=80', 0, 4),
(N'Desserts',  N'Berry Cheesecake',      N'Baked vanilla cheesecake with forest berries',                     8.50, N'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=600&q=80', 1, 1),
(N'Desserts',  N'Chocolate Fondant',     N'Warm dark chocolate cake, vanilla ice cream',                      9.00, N'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&q=80', 0, 2),
(N'Drinks',    N'Green Detox Smoothie',  N'Spinach, apple, banana, ginger, lime',                             6.00, N'https://images.unsplash.com/photo-1610970881699-44a5587cabec?w=600&q=80', 0, 1),
(N'Drinks',    N'Fresh Lemonade',        N'Lemon, mint, cane sugar, sparkling water',                         4.50, N'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=600&q=80', 0, 2);
GO

SELECT 'FoodZero DB ready' AS Status, (SELECT COUNT(*) FROM dbo.MenuItems) AS MenuItems;
GO
