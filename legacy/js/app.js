import { FormatDate } from "./modules/index.js";
import { Storage, ManageTask, localStorageConfig } from "./utils/index.js";
import { UI } from "./ui/index.js";

localStorageConfig();
new UI().refreshUI();

document.addEventListener("DOMContentLoaded", () => {
    
    let descOfTask = document.querySelector("#field-of-task");
    let nameOfTask = document.querySelector("#name-of-task");
    let todoForm = document.querySelector("#todo-form");
    let submitBtn = document.querySelector("#submit");

    todoForm.addEventListener("submit", (e) => {
        e.preventDefault();
        let descTask = descOfTask.value;
        let taskName = nameOfTask.value;

        let dateInstance = new FormatDate();
        let storageInstance = new Storage();
        let manageTask = new ManageTask(dateInstance, storageInstance, taskName, descTask);
        manageTask.addTask();
        new UI().refreshUI();
        todoForm.reset();
    })
})