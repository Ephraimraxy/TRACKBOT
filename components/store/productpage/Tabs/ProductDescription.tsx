import MDEditor from "@uiw/react-md-editor";
import React from "react";

const ProductDescription = ({
  description,
}: {
  description?: string | null;
}) => {
  const safeDescription =
    description ?? "No description available for this product.";

  return (
    <section className="prose-lg" data-color-mode="light">
      <MDEditor.Markdown source={safeDescription} />
    </section>
  );
};

export default ProductDescription;
