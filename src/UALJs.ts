import { Authenticator, Chain, UAL, User } from 'universal-authenticator-library'
import { UALJsDom } from './UALJsDom'

/**
 * Render configuration for the UAL renderer
 */
export interface UALJsRenderConfig {
  containerElement: HTMLElement
  buttonStyleOverride?: string
}

/**
 * Plain JS implementation for UAL Interaction with UI
 */
export class UALJs extends UAL {
  public isAutologin: boolean = false

  protected static SESSION_EXPIRATION_KEY = 'ual-session-expiration'
  protected static SESSION_AUTHENTICATOR_KEY = 'ual-session-authenticator'
  protected static SESSION_ACCOUNT_NAME_KEY = 'ual-session-account-name'

  protected static AUTHENTICATOR_LOADING_INTERVAL = 250

  protected userCallbackHandler: (users: User[]) => any
  protected accountNameInputValue: string = ''
  protected dom?: UALJsDom
  protected activeAuthenticator?: Authenticator

  private renderConfig?: UALJsRenderConfig

  /**
   *
   * @param userCallbackHandler Called with the array of users after a successful authenticator selection
   * @param chains Array of Chains the application wants to support
   * @param appName Name of the application
   * @param authenticators List of authenticators this app supports
   * @param renderConfig Optional UI rendering configuration for environments not using login
   */
  constructor(
    userCallbackHandler: (users: User[]) => any,
    chains: Chain[],
    appName: string,
    authenticators: Authenticator[],
    renderConfig?: UALJsRenderConfig
  ) {
    super(chains, appName, authenticators)

    if (renderConfig) {
      this.renderConfig = renderConfig
    }

    this.userCallbackHandler = userCallbackHandler

    this.loginUser = this.loginUser.bind(this)
  }

  /**
   * Initializes UAL: If a renderConfig was provided and no autologin authenticator
   * is returned it will render the Auth Button and relevant DOM elements.
   *
   */
  public init(): void {
    const authenticators = this.getAuthenticators()

    // perform this check first, if we're autologging in we don't render a dom
    if (!!authenticators.autoLoginAuthenticator) {
      this.isAutologin = true
      this.loginUser(authenticators.autoLoginAuthenticator)
      this.activeAuthenticator = authenticators.autoLoginAuthenticator
    } else {
      // check for existing session and resume if possible
      this.attemptSessionLogin(authenticators.availableAuthenticators)

      if (!this.renderConfig) {
        throw new Error('Render Configuration is required when no auto login authenticator is provided')
      }

      const { 
        containerElement,
        buttonStyleOverride = false,
      } = this.renderConfig as UALJsRenderConfig

      this.dom = new UALJsDom(
        this.loginUser,
        authenticators.availableAuthenticators,
        containerElement,
        buttonStyleOverride)

      this.dom!.generateUIDom()
    }
  }

  /**
   * Attempts to resume a users session if they previously logged in
   *
   * @param authenticators Available authenticators for login
   */
  private attemptSessionLogin(authenticators: Authenticator[]) {
    const sessionExpiration = localStorage.getItem(UALJs.SESSION_EXPIRATION_KEY) || null
    if (sessionExpiration) {
      // clear session if it has expired and continue
      if (new Date(sessionExpiration) <= new Date()) {
        localStorage.clear()
      } else {
        const authenticatorName = localStorage.getItem(UALJs.SESSION_AUTHENTICATOR_KEY)
        const sessionAuthenticator = authenticators.find(
          (authenticator) => authenticator.getName() === authenticatorName
        ) as Authenticator

        const accountName = localStorage.getItem(UALJs.SESSION_ACCOUNT_NAME_KEY) || undefined
        this.loginUser(sessionAuthenticator, accountName)
      }
    }
  }

  /**
   * App developer can call this directly with the preferred authenticator or render a
   * UI to let the user select their authenticator
   *
   * @param authenticator Authenticator chosen for login
   * @param accountName Account name (optional) of the user logging in
   */
  public async loginUser(authenticator: Authenticator, accountName?: string) {
    let users: User[]

    // set the active authenticator so we can use it in logout
    this.activeAuthenticator = authenticator

    const invalidateSeconds = this.activeAuthenticator.shouldInvalidateAfter()
    const invalidateAt = new Date()
    invalidateAt.setSeconds(invalidateAt.getSeconds() + invalidateSeconds)

    localStorage.setItem(UALJs.SESSION_EXPIRATION_KEY, invalidateAt.toString())
    localStorage.setItem(UALJs.SESSION_AUTHENTICATOR_KEY, authenticator.getName())

    try {
      await this.waitForAuthenticatorToLoad(authenticator)

      if (accountName) {
        users = await authenticator.login(accountName)

        localStorage.setItem(UALJs.SESSION_ACCOUNT_NAME_KEY, accountName)
      } else {
        users = await authenticator.login()
      }

      // send our users back
      this.userCallbackHandler(users)

    } catch (e) {
      console.error('Error', e)
      console.error('Error cause', e.cause ? e.cause : '')
      this.clearStorageKeys()
      throw e
    }

    // reset our modal state if we're not autologged in (no dom is rendered for autologin)
    if (!this.isAutologin) {
      this.dom!.reset()
    }
  }

  private async waitForAuthenticatorToLoad(authenticator: Authenticator) {
    return new Promise((resolve) => {
      if (!authenticator.isLoading()) {
        resolve()
        return
      }
      const authenticatorIsLoadingCheck = setInterval(() => {
        if (!authenticator.isLoading()) {
          clearInterval(authenticatorIsLoadingCheck)
          resolve()
        }
      }, UALJs.AUTHENTICATOR_LOADING_INTERVAL)
    })
  }

  /**
   * Clears the session data for the logged in user
   */
  public async logoutUser() {
    if (!this.activeAuthenticator) {
      throw Error('No active authenticator defined, did you login before attempting to logout?')
    }

    this.activeAuthenticator.logout()

    this.clearStorageKeys()
  }

  private clearStorageKeys() {
    // clear out our storage keys
    localStorage.removeItem(UALJs.SESSION_EXPIRATION_KEY)
    localStorage.removeItem(UALJs.SESSION_AUTHENTICATOR_KEY)
    localStorage.removeItem(UALJs.SESSION_ACCOUNT_NAME_KEY)
  }
}
