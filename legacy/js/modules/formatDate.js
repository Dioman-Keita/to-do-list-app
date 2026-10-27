export class FormatDate {
    constructor() {}
    
    getCurrentDate() {
        return new Date().toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        })
    }
}