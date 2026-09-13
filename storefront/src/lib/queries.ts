/**
 * Every GraphQL document the storefront sends.
 * Kept in one file so it can be validated against Saleor's schema in CI
 * (see `npm run graphql:check` in the repo root).
 */

/* ------------------------------------------------------------------ reads */

export const PRODUCTS_QUERY = /* GraphQL */ `
  query MistboxProducts($channel: String!) {
    products(first: 10, channel: $channel, sortBy: { field: NAME, direction: ASC }) {
      edges {
        node {
          id
          name
          slug
          description
          thumbnail(size: 1024, format: WEBP) {
            url
            alt
          }
          media {
            url
            alt
          }
          defaultVariant {
            id
          }
          variants {
            id
            name
            sku
            quantityAvailable
            pricing {
              price {
                gross {
                  amount
                  currency
                }
              }
            }
          }
          pricing {
            priceRange {
              start {
                gross {
                  amount
                  currency
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const SHIPPING_METHODS_QUERY = /* GraphQL */ `
  query CheckoutShippingMethods($id: ID!) {
    checkout(id: $id) {
      id
      shippingMethods {
        id
        name
        price {
          amount
          currency
        }
      }
    }
  }
`;

/* ------------------------------------------------------------- mutations */

export const CHECKOUT_CREATE = /* GraphQL */ `
  mutation MistboxCheckoutCreate($input: CheckoutCreateInput!) {
    checkoutCreate(input: $input) {
      checkout {
        id
        email
        totalPrice {
          gross {
            amount
            currency
          }
        }
        subtotalPrice {
          gross {
            amount
            currency
          }
        }
        lines {
          id
          quantity
          variant {
            id
            name
            product {
              name
            }
          }
          unitPrice {
            gross {
              amount
              currency
            }
          }
        }
        shippingMethods {
          id
          name
          price {
            amount
            currency
          }
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

export const CHECKOUT_SET_DELIVERY = /* GraphQL */ `
  mutation MistboxCheckoutSetDelivery($id: ID!, $deliveryMethodId: ID!) {
    checkoutDeliveryMethodUpdate(id: $id, deliveryMethodId: $deliveryMethodId) {
      checkout {
        id
        totalPrice {
          gross {
            amount
            currency
          }
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

export const CHECKOUT_SET_METADATA = /* GraphQL */ `
  mutation MistboxCheckoutSetMetadata($id: ID!, $input: [MetadataInput!]!) {
    updateMetadata(id: $id, input: $input) {
      errors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Records the Stripe payment against the checkout. Saleor treats a checkout
 * with a fully-charged transaction as payable, which is what lets
 * checkoutComplete turn it into a paid order.
 */
export const TRANSACTION_CREATE = /* GraphQL */ `
  mutation MistboxTransactionCreate($id: ID!, $transaction: TransactionCreateInput!) {
    transactionCreate(id: $id, transaction: $transaction) {
      transaction {
        id
        pspReference
        chargedAmount {
          amount
          currency
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

export const CHECKOUT_COMPLETE = /* GraphQL */ `
  mutation MistboxCheckoutComplete($id: ID!) {
    checkoutComplete(id: $id) {
      order {
        id
        number
        created
        status
        paymentStatus
        userEmail
        shippingMethodName
        total {
          gross {
            amount
            currency
          }
        }
        subtotal {
          gross {
            amount
          }
        }
        shippingPrice {
          gross {
            amount
          }
        }
        lines {
          id
          quantity
          productName
          variantName
          variant {
            id
          }
          totalPrice {
            gross {
              amount
            }
          }
        }
        shippingAddress {
          firstName
          lastName
          streetAddress1
          streetAddress2
          city
          countryArea
          postalCode
        }
        metadata {
          key
          value
        }
      }
      confirmationNeeded
      errors {
        field
        message
        code
      }
    }
  }
`;

export const PAGE_QUERY = /* GraphQL */ `
  query MistboxPage($slug: String!) {
    page(slug: $slug) {
      id
      title
      slug
      content
      seoTitle
      seoDescription
    }
  }
`;

/**
 * Everything the Stripe webhook needs about a checkout before it turns it into
 * an order. Transactions cover payment idempotency (Stripe delivers each event
 * at least once, so a retry must not book the payment twice); the rest —
 * email, address, metadata — is what lets a matching customer record be
 * created *before* `checkoutComplete` runs. Saleor only links an order to an
 * account that already exists at that exact moment (`assign_checkout_user` in
 * its own `complete_checkout.py`), so creating the record after the order
 * exists is always one step too late to ever link.
 */
export const CHECKOUT_FOR_COMPLETION = /* GraphQL */ `
  query MistboxCheckoutForCompletion($id: ID!) {
    checkout(id: $id) {
      id
      email
      transactions {
        id
        pspReference
      }
      shippingAddress {
        firstName
        lastName
        streetAddress1
        streetAddress2
        city
        countryArea
        postalCode
      }
      metadata {
        key
        value
      }
    }
  }
`;

/**
 * Editable copy, stored as ordinary Saleor pages so it is edited in the same
 * screen as the About page (Content → Models). Title carries the heading —
 * a stage label, or an email subject — and the rich-text content carries the
 * rest. No page-type attributes to configure.
 */
export const CONTENT_PAGES_QUERY = /* GraphQL */ `
  query MistboxContentPages($slugs: [String!]) {
    pages(first: 40, filter: { slugs: $slugs }) {
      edges {
        node {
          id
          slug
          title
          content
        }
      }
    }
  }
`;

/**
 * `updateMetadata` is generic across Saleor objects — the same mutation writes
 * to a checkout or an order. Named separately from CHECKOUT_SET_METADATA only
 * so call sites read clearly.
 */
export const SET_METADATA = /* GraphQL */ `
  mutation MistboxSetMetadata($id: ID!, $input: [MetadataInput!]!) {
    updateMetadata(id: $id, input: $input) {
      errors {
        field
        message
        code
      }
    }
  }
`;

/** Everything the order page, the packing screen and the emails need. */
export const ORDER_QUERY = /* GraphQL */ `
  query MistboxOrder($id: ID!) {
    order(id: $id) {
      id
      number
      created
      status
      paymentStatus
      userEmail
      shippingMethodName
      total {
        gross {
          amount
          currency
        }
      }
      subtotal {
        gross {
          amount
        }
      }
      shippingPrice {
        gross {
          amount
        }
      }
      lines {
        id
        quantity
        productName
        variantName
        variant {
          id
        }
        totalPrice {
          gross {
            amount
          }
        }
      }
      shippingAddress {
        firstName
        lastName
        streetAddress1
        streetAddress2
        city
        countryArea
        postalCode
      }
      fulfillments {
        status
        trackingNumber
      }
      metadata {
        key
        value
      }
    }
  }
`;

/** Open orders for the packing screen, newest first. */
export const OPEN_ORDERS_QUERY = /* GraphQL */ `
  query MistboxOpenOrders {
    orders(first: 50, sortBy: { field: CREATION_DATE, direction: DESC }) {
      edges {
        node {
          id
          number
          created
          status
          userEmail
          lines {
            quantity
            productName
          }
          shippingAddress {
            firstName
            lastName
            city
            countryArea
          }
          metadata {
            key
            value
          }
        }
      }
    }
  }
`;

/**
 * The subscription Saleor runs to build our webhook payload.
 *
 * Defining it means the body shape is ours rather than Saleor's legacy
 * envelope: exactly the fields below, on every delivery.
 *
 * Only the tracking-number event is subscribed. Saleor also fires
 * FULFILLMENT_CREATED when an order is fulfilled with a number in one step, and
 * the two arrive together — see tools/register-webhooks.mjs for why that race
 * had to be removed rather than guarded against.
 */
export const FULFILLMENT_SUBSCRIPTION = /* GraphQL */ `
  subscription MistboxFulfillmentEvents {
    event {
      __typename
      ... on FulfillmentTrackingNumberUpdated {
        fulfillment {
          id
          trackingNumber
        }
        order {
          id
          number
        }
      }
    }
  }
`;

/**
 * Writes a line onto the order's timeline in the Saleor dashboard, so stage
 * changes are visible where Daniya already looks rather than only in metadata.
 */
export const ORDER_NOTE_ADD = /* GraphQL */ `
  mutation MistboxOrderNoteAdd($order: ID!, $input: OrderNoteInput!) {
    orderNoteAdd(order: $order, input: $input) {
      errors {
        field
        message
        code
      }
    }
  }
`;

/** The admin list: searchable, filterable, and paged. */
export const ADMIN_ORDERS_QUERY = /* GraphQL */ `
  query MistboxAdminOrders($first: Int!, $after: String, $filter: OrderFilterInput) {
    orders(
      first: $first
      after: $after
      filter: $filter
      sortBy: { field: CREATION_DATE, direction: DESC }
    ) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          number
          created
          status
          userEmail
          total {
            gross {
              amount
              currency
            }
          }
          lines {
            quantity
            productName
            variantName
            productSku
            unitPrice {
              gross {
                amount
              }
            }
          }
          shippingAddress {
            firstName
            lastName
            city
            countryArea
          }
          fulfillments {
            trackingNumber
          }
          metadata {
            key
            value
          }
        }
      }
    }
  }
`;

/**
 * Signs in against Saleor's own staff accounts, so the admin login adds no
 * password storage of its own. Only ever called server-side, with the
 * password forwarded once and never kept.
 */
export const TOKEN_CREATE = /* GraphQL */ `
  mutation MistboxTokenCreate($email: String!, $password: String!) {
    tokenCreate(email: $email, password: $password) {
      token
      user {
        email
        isStaff
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/**
 * The two mutations behind "forgot password" for the admin login. Both are
 * unauthenticated on Saleor's side — anyone can ask for a reset email, and
 * anyone holding a valid token can set a new password — so all the actual
 * gating (must be @mist.box, must be staff) happens in our own route
 * handlers, not here.
 */
export const REQUEST_PASSWORD_RESET = /* GraphQL */ `
  mutation MistboxRequestPasswordReset($email: String!, $redirectUrl: String!) {
    requestPasswordReset(email: $email, redirectUrl: $redirectUrl) {
      errors {
        field
        message
        code
      }
    }
  }
`;

export const SET_PASSWORD = /* GraphQL */ `
  mutation MistboxSetPassword($email: String!, $password: String!, $token: String!) {
    setPassword(email: $email, password: $password, token: $token) {
      token
      user {
        email
        isStaff
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/**
 * The two operations behind quietly keeping a real Saleor customer record for
 * every order, without ever asking the buyer to create an account.
 *
 * `MANAGE_ORDERS` (already on the app) covers the lookup; `customerCreate`
 * needs `MANAGE_USERS`, which the app is granted separately — see
 * src/lib/customers.ts for why this stays a lookup-then-create rather than an
 * upsert, and why no `redirectUrl` is ever passed.
 */
export const FIND_USER_BY_EMAIL = /* GraphQL */ `
  query MistboxFindUserByEmail($email: String!) {
    user(email: $email) {
      id
      isStaff
    }
  }
`;

export const CUSTOMER_CREATE = /* GraphQL */ `
  mutation MistboxCustomerCreate($input: UserCreateInput!) {
    customerCreate(input: $input) {
      user {
        id
        email
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Files a real tracking number against an order — the same mutation Daniya's
 * manual paste-into-Saleor step has always used. Buying a label through the
 * admin calls this automatically; nothing downstream (the fulfillment
 * webhook, Shippo registration, the shipped email) needs to know the tracking
 * number arrived this way rather than by hand.
 */
export const ORDER_FULFILL = /* GraphQL */ `
  mutation MistboxOrderFulfill($order: ID!, $input: OrderFulfillInput!) {
    orderFulfill(order: $order, input: $input) {
      fulfillments {
        id
        trackingNumber
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/** The one warehouse boxes ship from. Queried rather than hardcoded so a
 *  second warehouse, if one is ever added, does not silently go unnoticed. */
export const FIRST_WAREHOUSE = /* GraphQL */ `
  query MistboxFirstWarehouse {
    warehouses(first: 1) {
      edges {
        node {
          id
        }
      }
    }
  }
`;

/**
 * Updates an existing customer record — used only to set `newsletter_opt_in`
 * on someone who already has an account (typically a past buyer) rather than
 * creating a second one. `updateMetadata` alone cannot be used here because
 * it needs the object's own ID, and the newsletter route only has an email.
 */
export const CUSTOMER_UPDATE = /* GraphQL */ `
  mutation MistboxCustomerUpdate($id: ID!, $input: CustomerInput!) {
    customerUpdate(id: $id, input: $input) {
      user {
        id
        email
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Everything needed to build or validate a box, in one authenticated read.
 *
 * Fetched with `saleorFetchAuthed` deliberately: items are published with
 * `visibleInListings: false`, so the anonymous products query cannot see them
 * at all — which is exactly what keeps them unbrowsable — while an app token
 * with Manage orders reads straight past that filter.
 *
 * Tiers and items come back together and are told apart by `productType.slug`,
 * so adding an item never needs a second round trip or a hardcoded type id.
 */
export const BOX_CATALOGUE_QUERY = /* GraphQL */ `
  query MistboxBoxCatalogue($channel: String!) {
    products(first: 100, channel: $channel) {
      edges {
        node {
          id
          name
          slug
          metadata {
            key
            value
          }
          productType {
            slug
          }
          thumbnail(size: 512, format: WEBP) {
            url
            alt
          }
          attributes {
            attribute {
              slug
            }
            values {
              name
              reference
            }
          }
          variants {
            id
            sku
            name
            quantityAvailable
            weight {
              unit
              value
            }
            metadata {
              key
              value
            }
            pricing {
              price {
                gross {
                  amount
                  currency
                }
              }
            }
            media {
              url(size: 512, format: WEBP)
              alt
            }
          }
        }
      }
    }
  }
`;
