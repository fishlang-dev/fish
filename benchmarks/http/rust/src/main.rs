// The benchmark's HTTP service on axum and tokio, as server.fsh serves it.
//   server <port>
use axum::{routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Item {
    #[allow(dead_code)]
    sku: String,
    qty: i64,
    price: f64,
}

#[derive(Deserialize)]
struct Order {
    id: i64,
    customer: String,
    items: Vec<Item>,
}

#[derive(Serialize)]
struct Summary {
    customer: String,
    id: i64,
    lines: usize,
    total: f64,
}

async fn order(Json(order): Json<Order>) -> Json<Summary> {
    let total = order.items.iter().map(|item| item.price * item.qty as f64).sum();
    Json(Summary { customer: order.customer, id: order.id, lines: order.items.len(), total })
}

#[tokio::main]
async fn main() {
    let port: u16 = std::env::args().nth(1).and_then(|p| p.parse().ok()).unwrap_or(8791);
    let app = Router::new().route("/hello", get(|| async { "hello" })).route("/order", post(order));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
