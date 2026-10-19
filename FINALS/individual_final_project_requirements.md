# QR-ATT — Event-Driven Programming Final Project & Hackathon Challenge

## PART I — INDIVIDUAL FINAL PROJECT

### 2. Final Project Objective

Develop a functional mobile or web-based system that allows a school to manage event attendance using QR codes. The system must demonstrate your understanding of:

- Event-driven programming
- User interface design
- Database integration
- Authentication
- Authorization
- CRUD operations
- QR code generation/scanning
- Data validation
- Security
- Real-time user interaction

You must be able to explain and demonstrate your own implementation during the Final Examination.

### 3. Required User Roles

Your system must support at least three roles:

#### A. Student

The Student can:

- Create/login to an account
- View personal information
- View available events
- Scan an event QR code
- Record attendance
- View personal attendance history

#### B. Teacher

The Teacher can:

- Login securely
- Create/manage events
- Generate an event QR code
- View attendance records
- Monitor attendance
- View attendance summaries

#### C. Administrator

The Administrator can:

- Manage users
- Manage events
- View overall attendance
- Manage or correct attendance records
- View system records/reports

### 4. Minimum Required Features

Your individual project must contain the following:

#### Authentication

- Login
- Registration
- Logout
- Session handling
- Password protection

#### User Management

- Student profile
- Teacher profile
- Administrator profile
- Role-based access

#### Event Management

A teacher or administrator must be able to:

- Create an event
- Edit an event
- View an event
- Close an event

An event should contain information such as:

- Event name
- Date
- Time
- Venue
- Description
- Status

#### QR Attendance

The system must allow:

1. Teacher/Admin creates an event.
2. System generates a QR code.
3. Student scans the QR code.
4. System validates the event.
5. System records the student's attendance.
6. Student receives confirmation.

#### Attendance Validation

The system must prevent:

- Duplicate attendance
- Attendance for closed events
- Invalid QR codes
- Unauthorized attendance recording

#### Attendance Records

The system must record at least:

- Student
- Event
- Date
- Time
- Attendance status

#### Attendance History

Students must be able to view their own attendance history. Teachers/Admins must be able to view attendance records for their events or the system.

### 5. Database Requirement

Your application must use a database. At minimum, your database should contain appropriate tables/entities for:

- Users
- Profiles
- Events
- Attendance

You may add additional tables when necessary. Your database must properly implement relationships between records.

### 6. Security Requirements

Your application must demonstrate basic security. You must implement:

- Authentication
- Role-based authorization
- Database access protection
- Input validation
- Duplicate attendance prevention
- Secure session handling
- Proper logout
- Protected database operations

If using Supabase, appropriate Row Level Security (RLS) policies must be implemented.

> **Important:** Never place passwords, secret keys, service-role keys, or other sensitive credentials directly in your source code or public Git repository.

### 7. Event-Driven Programming Requirement

Your project must clearly demonstrate event-driven programming. During your presentation, you must be able to identify at least five (5) important events in your application.

Examples:

1. User presses Login.
2. QR Scanner detects a QR code.
3. Attendance button is pressed.
4. Event is created.
5. Event status changes.
6. Database record is successfully inserted.
7. Invalid QR code is detected.
8. Duplicate attendance is detected.
9. User logs out.
10. Data is refreshed.

For each example, you should be able to explain:

**Event → Handler → Action → Result**

### 8. User Interface Requirements

Your application should be:

- Clean
- Easy to navigate
- Consistent
- Mobile-friendly or responsive
- Easy for students and teachers to understand

Your system should provide appropriate feedback for:

- Loading
- Success
- Error
- Empty data
- Invalid QR
- Duplicate attendance
- Unauthorized access
- Closed event

### 9. Individual Final Exam

During the Final Examination, you will demonstrate your own project individually. You must be able to:

1. Explain the purpose of your system.
2. Demonstrate the major features.
3. Explain your database.
4. Explain your event-driven processes.
5. Explain your authentication and authorization.
6. Demonstrate QR attendance.
7. Answer technical questions about your implementation.

> **Important:** You are expected to understand the code and implementation of your own project. You may be asked to modify a feature, explain a function, identify a database relationship, or troubleshoot a problem during the presentation.

### 10. Individual Final Project Rubric

| Criteria | Points |
|---|---:|
| Core Functionality | 25 |
| Authentication & Role-Based Access | 15 |
| Database Implementation | 15 |
| QR Attendance Process | 15 |
| Event-Driven Programming | 10 |
| UI/UX | 10 |
| Security & Validation | 5 |
| Individual Presentation & Defense | 5 |
| **TOTAL** | **100** |
