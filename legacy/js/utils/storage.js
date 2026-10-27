export class Storage {
    constructor() {}
    saveTask(data) {
        
        localStorage.setItem("task", JSON.stringify(data));
    }

    resetAllTask() {
        localStorage.setItem("task", JSON.stringify([]));
    }
    getTask() {
        const raw = localStorage.getItem("task");
        if (raw) {
          return JSON.parse(localStorage.getItem("task")) || [];
        } else {
            console.warn("Données invalides");
            return [];
        }
    }

}