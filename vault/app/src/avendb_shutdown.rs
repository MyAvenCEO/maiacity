//! The runtime's stop signal belongs to app state until durable close succeeds.
//! Kept free of Tauri so the device integration tests exercise this exact guard.
use std::future::Future;
use std::time::Duration;
use tokio::sync::oneshot;

pub(crate) struct RuntimeStop {
    quit: Option<oneshot::Sender<()>>,
    ended: oneshot::Receiver<()>,
}

impl RuntimeStop {
    pub(crate) fn new(quit: oneshot::Sender<()>, ended: oneshot::Receiver<()>) -> Self {
        Self {
            quit: Some(quit),
            ended,
        }
    }

    /// Borrows the stop signal, so cancellation or a failed fence cannot drop it.
    pub(crate) async fn finish(
        &mut self,
        close: impl Future<Output = Result<(), String>>,
    ) -> Result<(), String> {
        tokio::pin!(close);
        tokio::select! {
            result = &mut close => result,
            () = tokio::time::sleep(Duration::from_secs(5)) => {
                tracing::warn!("avenDB shutdown is taking more than five seconds; keeping its runtime alive until the durable close fence completes");
                close.await
            }
        }?;
        tracing::info!("avenDB shutdown: stores fenced; stopping the device runtime");
        if let Some(quit) = self.quit.take() {
            quit.send(())
                .map_err(|_| "the device runtime ended before it was asked to stop".to_string())?;
        }
        (&mut self.ended)
            .await
            .map_err(|_| "the device runtime did not acknowledge its end".to_string())?;
        tracing::info!("avenDB shutdown: device runtime stopped");
        Ok(())
    }
}
