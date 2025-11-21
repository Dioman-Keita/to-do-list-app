# 📝 To-Do List App

Task management application developed in **Vanilla JavaScript**

## 🚀 Features
- Add/delete tasks
- Mark as completed/uncompleted
- Data persistence (localStorage)
- Dynamic counters

## 🧠 Persistence
- Tasks saved in localStorage will always be available
- The application will automatically load tasks on page load

## ⚠️ Points to consider
- Once a task is deleted, it will no longer be available (no recovery possible)
- If the browser is reset, all tasks will be lost
- If you run `localStorage.clear()` in your console, all tasks will be deleted

## 🧯 Troubleshooting
If the application no longer works properly, try the following steps:
- Update your browser
- Save your tasks manually:
1. Run in the console: 
```js 
console.log(JSON.parse(localStorage.getItem("task"))); 
```
2. Copy the displayed data into a `.txt` file
3. Run:
```js
localStorage.clear()
```
to reset the application

4. Reinsert your data manually if necessary
- If the problem persists, leave me a comment on the [GitHub repository](https://github.com/Dioman-Keita/To-Do-List-App)

## 🛠️ Technologies Used
- JavaScript (ES6 modules)
- HTML5
- CSS3
- localStorage

## 📦 Overview
![To-Do List App](src/screenshots/image.png)
![To-Do List App](src/screenshots/image-2.png)
![To-Do List App](src/screenshots/image-3.png)

## 📖 Usage
Start by opening the `index.html` file in your browser. You can then add, delete, and change the status of a task. To do so, follow these steps:

**Add a task**

Enter the task name and click "Save"

**Change its status**

Click `completed` or `uncompleted` to change the status.

**Delete**

Click `delete`

## Installation
```bash
[git clone https://github.com/Dioman-Keita/to-do-list-app](https://github.com/Dioman-Keita/to-do-list-app.git)
cd to-do-list-app
```

### For local development:
If you are on a local server, install Live server:
```bash
npm install -g live-server
live-server
```

## 📄 License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
