class AppState {
    private _isShowMoreMenu = $state(false);
    private _isShowSettingsPage = $state(false);
    private _isShowAboutPage = $state(false);
    private _currentDocumentName = $state<string | null>(null);
    private _currentDocumentPath = $state<string | null>(null);

    get currentDocumentName() {
        return this._currentDocumentName;
    }

    set currentDocumentName(value: string | null) {
        this._currentDocumentName = value;
    }

    get currentDocumentPath() {
        return this._currentDocumentPath;
    }

    set currentDocumentPath(value: string | null) {
        this._currentDocumentPath = value;
    }

    get isShowMoreMenu() {
        return this._isShowMoreMenu;
    }

    set isShowMoreMenu(value: boolean) {
        this._isShowMoreMenu = value;
    }

    get isShowSettingsPage() {
        return this._isShowSettingsPage;
    }

    set isShowSettingsPage(value: boolean) {
        this._isShowSettingsPage = value;
        this._isShowMoreMenu = false;
    }

    get isShowAboutPage() {
        return this._isShowAboutPage;
    }

    set isShowAboutPage(value: boolean) {
        this._isShowAboutPage = value;
        this._isShowMoreMenu = false;
    }
}

export const appState = new AppState();
