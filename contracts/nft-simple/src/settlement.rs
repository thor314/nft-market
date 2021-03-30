use crate::*;

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SettlementArgs {
    pub approval_id: U64,
    pub token_id: TokenId,
    pub buyer_id: AccountId,
}

trait FungibleTokenReceiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128;
}

#[near_bindgen]
impl FungibleTokenReceiver for Contract {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String
    ) -> U128 {
        let SettlementArgs {
            approval_id,
            token_id,
            buyer_id,
        } = near_sdk::serde_json::from_str(&msg).expect("Valid SettlementArgs");

        let token = self.nft_token(token_id.clone()).expect("No token found");
        let ft_token_id = env::predecessor_account_id();

        env::log(format!(
            "Market {} sent {} FTs of type {} to transfer NFT from {} to {}",
            sender_id.clone(),
            u128::from(amount),
            ft_token_id.clone(),
            token.owner_id.clone(),
            buyer_id.clone(),
        ).as_bytes());

        // WARNING internal.rs edited
        // sender_id (market) is approved_id, but we want to transfer token to buyer_id
        // using memo field to override receiver_id arg in self.internal_transfer
        let (previous_owner_id, approved_account_ids) = self.internal_transfer(
            &token.owner_id,
            &sender_id,
            &token_id,
            Some(approval_id),
            Some(buyer_id),
        );
        refund_approved_account_ids(previous_owner_id, &approved_account_ids);

        ext_ft_transfer::ft_transfer(
            token.owner_id,
            amount, 
            None,
            &ft_token_id,
            1,
            env::prepaid_gas() - GAS_FOR_FT_TRANSFER,
        );

        // assume all tokens sent here from marketplace contract is what is needed to be paid
        amount
    }
}

#[ext_contract(ext_ft_transfer)]
trait ExtTransfer {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}