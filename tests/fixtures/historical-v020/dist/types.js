export class OntologyError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
