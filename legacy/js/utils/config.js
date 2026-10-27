export function localStorageConfig() {
    if (localStorage.getItem("task") === null) {
            localStorage.setItem("task", JSON.stringify([]));
        } else {
            console.log("La clé existe")
    }
}