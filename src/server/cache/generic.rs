use std::borrow::Borrow;
use std::borrow::Cow;
use std::hash::Hash;
use rustc_hash::FxHashMap as HashMap;

pub trait CacheProvider<K, V>
where
    K: ?Sized + Eq,
    V: ?Sized + ToOwned, {
    fn get(&self, key: &K) -> Option<Cow<'_, V>>;
    fn insert(&mut self, key: &K, value: Cow<V>);
    fn remove(&mut self, key: &K);
}

pub struct MemoryCache<K, V>
where
    K: ?Sized + ToOwned + Eq + Hash,
    V: ?Sized + ToOwned, {
    map: HashMap<K::Owned, V::Owned>,
}

impl<K, V> MemoryCache<K, V>
where
    K: ?Sized + ToOwned + Eq + Hash,
    V: ?Sized + ToOwned,{
    pub fn new() -> Self {
        Self {
            map: HashMap::default(),
        }
    }
}

impl<K, V> CacheProvider<K, V> for MemoryCache<K, V>
where
    K: ?Sized + ToOwned + Eq + Hash,
    V: ?Sized + ToOwned,
    K::Owned: Eq + Hash, {
    fn get(&self, key: &K) -> Option<Cow<'_, V>> {
        self.map
            .get(key)
            .map(Borrow::borrow)
            .map(Cow::Borrowed)
    }

    fn insert(&mut self, key: &K, value: Cow<V>) {
        self.map.insert(key.to_owned(), value.into_owned());
    }

    fn remove(&mut self, key: &K) {
        self.map.remove(key);
    }
}
