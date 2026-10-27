import { Storage, ManageTask } from "../utils/index.js";
import { FormatDate } from "../modules/index.js";
export class UI {
    constructor() {
        this.manageTask = new ManageTask(new FormatDate, new Storage);
        this.task = this.manageTask.getAllTask();
    };
    loadTask() {

            let completedTask = this.manageTask.getTaskCompleted();
            let uncompletedTask = this.manageTask.getTaskUncompleted();
    
            let listOfTaskCompleted = document.querySelector("#list-of-task-completed");
            let listOfTaskUncompleted = document.querySelector("#list-of-task-uncompleted");

            listOfTaskCompleted.replaceChildren();
            for (const task of completedTask) {
                let li = document.createElement("li");
                li.innerHTML = `<span data-status="${task.status}" data-id="${task.id}" class="completed-task"><strong>${task.name}</strong> : ${task.description}<br><strong>status :</strong> ${task.status}<br><strong>Date :</strong> ${task.date}</span><br><div><button class="change-task-status-completed-btn">inachevée</button><button class="remove-task-btn">supprimer</button></div>`;
                listOfTaskCompleted.appendChild(li);
            }
    
            listOfTaskUncompleted.replaceChildren();
            for (const task of uncompletedTask) {
                let li = document.createElement("li");
                li.innerHTML = `<span data-status="${task.status}" data-id="${task.id}" class="uncompleted-task"><strong>${task.name}</strong> : ${task.description}<br><strong>status :</strong> ${task.status}<br><strong>Date :</strong> ${task.date}</span><br><div><button class="change-task-status-uncompleted-btn">achevée</button><button class="remove-task-btn">supprimer</button></div>`;
                listOfTaskUncompleted.appendChild(li);
            }
            this.addTaskEvent();
    }
    updateTaskCount() {
       this.manageTask.updateTaskCount();
    }
    refreshUI() {
        this.updateTaskCount();
        this.loadTask();
    }
    addTaskEvent() {
        
        let changeTaskCompletedStatusBtn = document.querySelectorAll(".change-task-status-completed-btn");
        let changeTaskUncompletedStatusBtn = document.querySelectorAll(".change-task-status-uncompleted-btn");
        let removeTaskBtn = document.querySelectorAll(".remove-task-btn");

        changeTaskCompletedStatusBtn.forEach(task => {
            task.addEventListener("click", () => {
                let dataTask = task.closest("li").querySelector("span");
                let taskInfo = {
                    id: dataTask.dataset.id,
                    status: dataTask.dataset.status
                }
                this.manageTask.markATaskAsUncompleted(taskInfo.id);
                this.refreshUI()
            })
        })
        changeTaskUncompletedStatusBtn.forEach(task => {
            task.addEventListener("click", () => {
                let dataTask = task.closest("li").querySelector("span");
                let taskInfo = {
                    id: dataTask.dataset.id,
                    status: dataTask.dataset.status
                }
                this.manageTask.markATaskAsCompleted(taskInfo.id);
                this.refreshUI();
            })
        })

        removeTaskBtn.forEach(task => {
            task.addEventListener("click", () => {
                let dataTask = task.closest("li").querySelector("span");
                let taskInfo = {
                    id: dataTask.dataset.id,
                    status: dataTask.dataset.status
                }
                this.manageTask.removeTask(taskInfo.id);
                this.refreshUI();
            })
        })
    }
   
}