export class ManageTask {

    constructor(dateInstance, StorageInstance, taskName = undefined, descOfTask = undefined, status = "inachevée") {
        this.dateInstance = dateInstance;
        this.StorageInstance = StorageInstance;
        this.taskName = taskName,
        this.descOfTask = descOfTask,
        this.status = status
    }

    generateId() {
        let random = Math.floor(Math.random() * 1000);
        return `task-${Date.now()}-${random}`;
    }

    
    addTask() {
            let task = this.getAllTask();
            if (task) {
                task.push ({
                id: this.generateId(),
                name: this.taskName,
                description: this.descOfTask,
                date: this.dateInstance.getCurrentDate(),
                status: this.status
            })
            this.StorageInstance.saveTask(task);
            alert(`Tâche ${this.taskName} ajoutée avec succès`);
        } else {
            alert("Aucune tache enregistrée");
        }
    }

    
    removeTask(id) {
        let tasks = this.getAllTask();
        if (tasks) {
            let found = tasks.find(t => t.id === id);
            let newTask = tasks.filter((task) => task.id !== id);
            this.StorageInstance.saveTask(newTask);
            alert(`Tâche ${found.name} supprimée avec succès`);
        } else {
            throw new Error("Tâche non trouvé dans le localStorage");
        }
    }
    
    counterOfTaskCompleted() {
        let task = this.getAllTask();
        return task.filter(t => t.status !== "inachevée").length;
    }
    
    counterOfTaskUncompleted() { 
        let task = this.getAllTask();
        return task.filter(t => t.status !== "achevée").length;
    }

    updateTaskCount() {
        let taskCompleted = this.counterOfTaskCompleted();
        let taskUncompleted = this.counterOfTaskUncompleted();

        let counterOfTaskCompleted = document.querySelector("#completed");
        let counterOfTaskUnCompleted = document.querySelector("#uncompleted");

        let noTaskCompletedMessage = document.querySelector(".no-task-completed-message");
        let noTaskUncompletedMessage = document.querySelector(".no-task-uncompleted-message");

        noTaskCompletedMessage.innerText = taskCompleted === 0 ? "Aucune tâche completée pour l'instant" : "";
        noTaskUncompletedMessage.innerText = taskUncompleted === 0 ? "Aucune tâche inachevées pour l'instant" : "";

        counterOfTaskCompleted.innerText = `(${taskCompleted})`;
        counterOfTaskUnCompleted.innerText = `(${taskUncompleted})`;
    }

    getTaskCompleted() {
        let task = this.getAllTask();
        return task.filter(t => t.status !== "inachevée");
    }

    getTaskUncompleted() {
        let task = this.getAllTask();
        return task.filter(t => t.status !== "achevée");
    }

    getAllTask() {
        return this.StorageInstance.getTask();
    }
    
    markATaskAsCompleted(id) {
        let task = this.getAllTask();
        let index = task.findIndex(t => t.id === id);
        if (task && index !== -1) {
            task[index].status = "achevée";
            task[index].date = this.dateInstance.getCurrentDate();
            this.StorageInstance.saveTask(task);
            alert(`Tâche ${task[index].name} marquée comme achevée`);
        } else {
            alert("Tâche non trouvée dans le localStorage");
            console.warn("impossible de marquer la tache comme achevée");
        }
    }
    markATaskAsUncompleted(id) {
        let task = this.getAllTask();
        let index = task.findIndex(t => t.id === id);
        if (index !== -1) {
            task[index].status = "inachevée";
            task[index].date = this.dateInstance.getCurrentDate();
            this.StorageInstance.saveTask(task);
            alert(`Tâche ${task[index].name} marquée comme inachevée`);
        } else {
            alert("Tâche non trouvée dans le localStorage");
            console.warn("impossible de marquer la tache comme achevée");
        }
    }
}