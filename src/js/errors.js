export class Errors {
    constructor(el_id) {
        this.el_id = el_id
    }

    get el() {
        return document.getElementById(this.el_id)
    }

    createEl(text) {
        const li = document.createElement("li")
        const textNode = document.createTextNode(text)

        li.appendChild(textNode)
        return li
    }

    addError(text) {
        const newLiEl = this.createEl(text);
        this.el.appendChild(newLiEl);
    }
}
