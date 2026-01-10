use std::fmt;

pub struct ErrorContext {
    pub file: &'static str,
    pub line: u32,
    pub message: String,
}

impl fmt::Display for ErrorContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}\n    at {}:{}", self.message, self.file, self.line)
    }
}

#[macro_export] macro_rules! context {
    ($message:expr $(, $message_arg:expr)*) => {
        $crate::__macro_export::ErrorContext {
            file: file!(),
            line: line!(),
            message: format!($message $(, $message_arg)*),
        }
    };
}

#[macro_export] macro_rules! api_call {
    (unsafe { $expr:expr }) => { unsafe {
        $crate::anyhow::Context::with_context(
            $expr,
            || $crate::context!("{} failed", $crate::api_name_of!($expr)))
    }};
    ($expr:expr) => {{
        $crate::anyhow::Context::with_context(
            $expr,
            || $crate::context!("{} failed", $crate::api_name_of!($expr)))
    }};
}

#[macro_export] macro_rules! api_name_of {
     ($expr:expr) => {
        $crate::__macro_export::api_name_of_internal! {
            #[api_name_args(
                type_name = $crate::type_name,
                type_name_of = $crate::type_name_of_val)]
            $expr
        }
     };
}

#[cfg(test)]
#[expect(dead_code, reason = "test code")]
#[expect(clippy::unused_self, reason = "test code")]
mod test {
    #[test] fn api_call() {
        assert!(
            api_call!("test".parse::<u32>())
                .unwrap_err()
                .to_string()
                .starts_with("str::parse::<u32> failed"));
    }

    fn foo<P0, P1>(_: P0, _: P1) {}

    struct Foo;
    impl Foo {
        fn bar<P0, P1>(&self, _: P0, _: P1) {}
    }

    #[test] fn api_name_of() {
        let foo = Foo;
        assert_eq!(crate::api_name_of!(foo.bar(0u32, 0u32)), "Foo::bar");
        assert_eq!(crate::api_name_of!(foo.bar::<u32, u32>(0, 0)), "Foo::bar::<u32, u32>");

        assert_eq!(crate::api_name_of!(foo(0u32, 0u32)), "foo");
        assert_eq!(crate::api_name_of!(foo::<u32, u32>(0, 0)), "foo::<u32, u32>");

        assert_eq!(crate::api_name_of!(super::test::foo(0u32, 0u32)), "foo");
        assert_eq!(crate::api_name_of!(super::test::foo::<u32, u32>(0, 0)), "foo::<u32, u32>");

        assert_eq!(crate::api_name_of!(Foo::bar(0u32, 0u32)), "Foo::bar");
        assert_eq!(crate::api_name_of!(Foo::bar::<u32, u32>(0, 0)), "Foo::bar::<u32, u32>");

        assert_eq!(crate::api_name_of!(super::test::Foo::bar(0u32, 0u32)), "Foo::bar");
        assert_eq!(crate::api_name_of!(super::test::Foo::bar::<u32, u32>(0, 0)), "Foo::bar::<u32, u32>");
    }
}
